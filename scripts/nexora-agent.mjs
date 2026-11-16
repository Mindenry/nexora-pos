import { spawn } from 'node:child_process';
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const logFile = path.join(root, '.nexora-agent.log');
const apiEntry = path.join(root, 'apps', 'api', 'dist', 'index.js');

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // Logging must never crash the supervisor.
  }
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(600);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function start(command, args, name) {
  log(`starting ${name}`);
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (data) => {
    for (const line of String(data).split(/\r?\n/)) {
      if (line.trim()) log(`[${name}] ${line}`);
    }
  });
  child.stderr.on('data', (data) => {
    for (const line of String(data).split(/\r?\n/)) {
      if (line.trim()) log(`[${name}:err] ${line}`);
    }
  });
  child.on('exit', (code, signal) => {
    log(`${name} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  return child;
}

const useBuiltApi = existsSync(apiEntry);
let apiChild = null;
let webChild = null;
let stopping = false;

function ensureApi() {
  if (stopping) return;
  if (apiChild && apiChild.exitCode === null) return;
  apiChild = useBuiltApi
    ? start(process.execPath, [apiEntry], 'api')
    : start(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:api'], 'api-dev');
}

function ensureWeb() {
  if (stopping) return;
  if (webChild && webChild.exitCode === null) return;
  webChild = start(process.execPath, [path.join(here, 'lan-server.mjs')], 'lan');
}

async function tick() {
  if (!(await portOpen(4000))) ensureApi();
  if (!(await portOpen(5173))) ensureWeb();
}

function shutdown() {
  stopping = true;
  log('stopping agent');
  for (const child of [apiChild, webChild]) {
    if (child && child.exitCode === null) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

mkdirSync(path.dirname(logFile), { recursive: true });
log(`NEXORA agent started (api=${useBuiltApi ? 'dist' : 'tsx watch'})`);
void tick();
setInterval(() => void tick(), 10_000);
