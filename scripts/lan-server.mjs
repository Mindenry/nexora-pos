import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'apps', 'web', 'dist');
const indexFile = path.join(dist, 'index.html');
const API_HOST = '127.0.0.1';
const API_PORT = 4000;
const PORT = 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

if (!existsSync(indexFile)) {
  console.error(`Build not found at ${dist}. Run "npm run build -w @nexora/web" first.`);
  process.exit(1);
}

function proxy(req, res, pathname, search) {
  const headers = { ...req.headers, host: `${API_HOST}:${API_PORT}` };
  const upstream = http.request(
    {
      host: API_HOST,
      port: API_PORT,
      method: req.method,
      path: `${pathname}${search}`,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    }
    res.end(
      JSON.stringify({
        error: {
          code: 'INFRA_DB_UNAVAILABLE',
          messageTh: 'เชื่อมต่อ API ไม่ได้',
          messageEn: 'Cannot reach the API.',
          details: error.message,
          retryable: true,
        },
      }),
    );
  });
  req.pipe(upstream);
}

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isImmutable = filePath.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api') || pathname.startsWith('/uploads')) {
      proxy(req, res, pathname, url.search);
      return;
    }

    const candidate = path.resolve(dist, `.${pathname}`);
    if (!candidate.startsWith(dist)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      sendFile(req, res, candidate);
      return;
    }

    // SPA fallback for client-side routes; unknown asset paths stay 404.
    if (path.extname(pathname)) {
      res.writeHead(404).end('Not found');
      return;
    }
    sendFile(req, res, indexFile);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

server.on('error', (error) => {
  console.error('LAN server error:', error.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NEXORA LAN server: http://0.0.0.0:${PORT} -> API ${API_HOST}:${API_PORT}`);
});
