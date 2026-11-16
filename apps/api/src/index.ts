import { createDb } from '@nexora/db';
import { createApp } from './app';
import { loadConfig } from './config';
import { logger, setLogLevel } from './logger';

const config = loadConfig();
setLogLevel(config.logLevel);
const db = createDb(config.databaseUrl, { applicationName: 'nexora-api' });
const app = createApp({ db, config });

const server = app.listen(config.port, () => {
  logger.info('api_started', { port: config.port, env: config.nodeEnv });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('api_shutdown', { signal });
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: reason instanceof Error ? reason.stack : String(reason) });
});
