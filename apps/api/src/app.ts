import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express, { Router, type Express } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Db } from '@nexora/db';
import { NexoraError } from '@nexora/shared';
import type { Config } from './config';
import { createAuthMiddleware, requireEmployee } from './http/auth';
import { errorHandler, notFoundHandler } from './http/errors';
import { logger } from './logger';
import { authRoutes, onboardingRoutes } from './modules/auth';
import { catalogRoutes } from './modules/catalog';
import { customerRoutes } from './modules/customers';
import { inventoryRoutes } from './modules/inventory';
import { peopleRoutes } from './modules/people';
import { platformRoutes } from './modules/platform';
import { posRoutes } from './modules/pos';
import { paymentWebhookRoutes, promptpayRoutes } from './modules/promptpay';
import { promotionRoutes } from './modules/promotions';
import { purchasingRoutes } from './modules/purchasing';
import { reportRoutes } from './modules/reports';
import { salesRoutes } from './modules/sales';
import { notificationRoutes, settingsRoutes } from './modules/settings';
import { shiftRoutes } from './modules/shifts';
import { uploadRoutes, UPLOAD_DIR } from './modules/uploads';
import { configurePromptPayCrypto } from './services/promptpay-crypto';

export interface AppDeps {
  db: Db;
  config: Config;
}

export function createApp({ db, config }: AppDeps): Express {
  configurePromptPayCrypto({
    encryptionKey: config.promptpayEncryptionKey,
    sessionSecret: config.sessionSecret,
  });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.isProd ? 1 : false);
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buffer) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(cookieParser());
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

  app.use((req, res, next) => {
    const id = String(req.headers['x-request-id'] ?? randomUUID());
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    const started = Date.now();
    res.on('finish', () => {
      logger.info('http_request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - started,
        correlationId: id,
        userId: req.ctx?.user.id,
        tenantId: req.ctx?.user.tenantId,
      });
    });
    next();
  });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (config.isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // CSRF: same-origin check plus a required client header on every mutation.
  const isAllowedOrigin = (origin: string): boolean => {
    if (config.webOrigins.includes(origin)) return true;
    // LAN/tablet development: accept private-network origins only when the API
    // is running in development/test. Production stays on the exact allowlist.
    if (config.isProd) return false;
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '::1' ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
      );
    } catch {
      return false;
    }
  };

  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path.startsWith('/api/payments/webhook/')) return next();
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return next(new NexoraError('AUTH_PERMISSION_DENIED', { reason: 'origin' }));
    }
    if (req.headers['x-nexora-client'] !== 'web') {
      return next(new NexoraError('AUTH_PERMISSION_DENIED', { reason: 'csrf_header' }));
    }
    return next();
  });

  const globalLimiter = rateLimit({
    windowMs: 60_000,
    limit: 1200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.nodeEnv === 'test',
  });
  app.use('/api', globalLimiter);

  // Public signed provider webhook; no session/CSRF, verified by HMAC instead.
  app.use('/api/payments/webhook', paymentWebhookRoutes(db));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isProd ? 20 : 500,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.nodeEnv === 'test',
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? '')}:${String((req.body as { email?: string })?.email ?? '')}`,
    handler: (_req, _res, next) => next(new NexoraError('AUTH_RATE_LIMITED')),
  });

  app.get('/api/health', async (_req, res) => {
    const started = Date.now();
    try {
      await db.queryGlobal('SELECT 1');
      res.json({
        data: {
          status: 'ok',
          database: 'ok',
          latencyMs: Date.now() - started,
          uptimeSeconds: Math.round(process.uptime()),
          version: process.env.npm_package_version ?? '0.1.0',
        },
      });
    } catch {
      res.status(503).json({
        error: {
          code: 'INFRA_DB_UNAVAILABLE',
          message: 'ระบบฐานข้อมูลไม่พร้อมใช้งาน',
          messageTh: 'ระบบฐานข้อมูลไม่พร้อมใช้งาน',
          messageEn: 'Database unavailable.',
          retryable: true,
        },
      });
    }
  });

  const requireAuth = createAuthMiddleware(db);

  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth/register', loginLimiter);
  app.use('/api/auth', authRoutes(db, config, requireAuth));

  const protectedApi = Router();
  protectedApi.use(requireAuth);
  protectedApi.use('/onboarding', requireEmployee, onboardingRoutes(db));
  protectedApi.use(catalogRoutes());
  protectedApi.use(inventoryRoutes());
  protectedApi.use(shiftRoutes());
  protectedApi.use(posRoutes());
  protectedApi.use(promptpayRoutes());
  protectedApi.use(salesRoutes());
  protectedApi.use(purchasingRoutes());
  protectedApi.use(customerRoutes());
  protectedApi.use(promotionRoutes());
  protectedApi.use(peopleRoutes());
  protectedApi.use(settingsRoutes());
  protectedApi.use(notificationRoutes());
  protectedApi.use(reportRoutes());
  protectedApi.use(uploadRoutes());
  protectedApi.use(platformRoutes(db));

  // Feature modules are registered by the module index (added per milestone).
  app.use('/api', protectedApi);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
