import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '@nexora/db';
import {
  NexoraError,
  paymentProviderUpdateSchema,
  promptpayAccountInputSchema,
  promptpayAccountUpdateSchema,
  promptpayCancelSchema,
  promptpayConfirmSchema,
  promptpaySessionCreateSchema,
  promptpaySessionQuerySchema,
  uuidSchema,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { created, noContent, ok } from '../http/respond';
import { decryptSecret } from '../services/promptpay-crypto';
import {
  createPaymentProvider,
  deletePaymentProvider,
  getPaymentProvider,
  listWebhookEvents,
  processWebhookEvent,
  rotatePaymentProviderSecret,
  testPaymentProvider,
  updatePaymentProvider,
  verifyWebhookSignature,
} from '../services/payment-providers';
import {
  cancelPromptPaySession,
  confirmPromptPaySession,
  createPromptPayAccount,
  createPromptPaySession,
  deletePromptPayAccount,
  getPromptPaySession,
  getStaticPromptPayQr,
  listPromptPayAccounts,
  listPromptPaySessions,
  regeneratePromptPaySession,
  setDefaultPromptPayAccount,
  updatePromptPayAccount,
} from '../services/promptpay';

const accountQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional(),
});

function debugPayloadEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function promptpayRoutes(): Router {
  const router = Router();

  // ── Accounts ──────────────────────────────────────────────────────────────
  router.get('/promptpay/accounts', requirePermission('promptpay.accounts.read'), async (req, res) => {
    const query = accountQuerySchema.parse(req.query);
    const accounts = await req.ctx.withDb((client) =>
      listPromptPayAccounts(client, req.ctx.tenant!.id, query.includeInactive ?? false),
    );
    ok(res, accounts);
  });

  router.post(
    '/promptpay/accounts',
    requirePermission('promptpay.accounts.manage'),
    async (req, res) => {
      const input = promptpayAccountInputSchema.parse(req.body);
      const account = await req.ctx.withDb((client) =>
        createPromptPayAccount(client, req.ctx, input),
      );
      created(res, account);
    },
  );

  router.patch(
    '/promptpay/accounts/:id',
    requirePermission('promptpay.accounts.manage'),
    async (req, res) => {
      const id = uuidSchema.parse(req.params.id);
      const input = promptpayAccountUpdateSchema.parse(req.body);
      const account = await req.ctx.withDb((client) =>
        updatePromptPayAccount(client, req.ctx, id, input),
      );
      ok(res, account);
    },
  );

  router.delete(
    '/promptpay/accounts/:id',
    requirePermission('promptpay.accounts.manage'),
    async (req, res) => {
      const id = uuidSchema.parse(req.params.id);
      await req.ctx.withDb((client) => deletePromptPayAccount(client, req.ctx, id));
      noContent(res);
    },
  );

  router.get(
    '/promptpay/accounts/:id/static-qr',
    requirePermission('promptpay.accounts.read'),
    async (req, res) => {
      const id = uuidSchema.parse(req.params.id);
      const qr = await req.ctx.withDb((client) =>
        getStaticPromptPayQr(client, req.ctx, id, { includePayload: debugPayloadEnabled() }),
      );
      ok(res, qr);
    },
  );

  router.post(
    '/promptpay/accounts/:id/default',
    requirePermission('promptpay.accounts.manage'),
    async (req, res) => {
      const id = uuidSchema.parse(req.params.id);
      const account = await req.ctx.withDb((client) =>
        setDefaultPromptPayAccount(client, req.ctx, id),
      );
      ok(res, account);
    },
  );

  // ── Automatic settlement provider ─────────────────────────────────────────
  router.get(
    '/promptpay/provider',
    requirePermission('promptpay.providers.manage'),
    async (req, res) => {
      const config = await req.ctx.withDb((client) =>
        getPaymentProvider(client, req.ctx.tenant!.id),
      );
      ok(res, config);
    },
  );

  router.post(
    '/promptpay/provider',
    requirePermission('promptpay.providers.manage'),
    async (req, res) => {
      const input = paymentProviderUpdateSchema.parse(req.body);
      const result = await req.ctx.withDb((client) =>
        createPaymentProvider(client, req.ctx, input),
      );
      created(res, result);
    },
  );

  router.patch(
    '/promptpay/provider',
    requirePermission('promptpay.providers.manage'),
    async (req, res) => {
      const input = paymentProviderUpdateSchema.parse(req.body);
      const config = await req.ctx.withDb((client) =>
        updatePaymentProvider(client, req.ctx, input),
      );
      ok(res, config);
    },
  );

  router.post(
    '/promptpay/provider/rotate',
    requirePermission('promptpay.providers.manage'),
    async (req, res) => {
      const result = await req.ctx.withDb((client) =>
        rotatePaymentProviderSecret(client, req.ctx),
      );
      ok(res, result);
    },
  );

  router.delete(
    '/promptpay/provider',
    requirePermission('promptpay.providers.manage'),
    async (req, res) => {
      await req.ctx.withDb((client) => deletePaymentProvider(client, req.ctx));
      noContent(res);
    },
  );

  router.post(
    '/promptpay/provider/test',
    requirePermission('promptpay.providers.manage'),
    async (req, res) => {
      const result = await req.ctx.withDb((client) =>
        testPaymentProvider(client, req.ctx.tenant!.id),
      );
      ok(res, result);
    },
  );

  router.get(
    '/promptpay/provider/events',
    requirePermission('promptpay.providers.manage'),
    async (req, res) => {
      const limit = Number(req.query.limit ?? 20);
      const events = await req.ctx.withDb((client) =>
        listWebhookEvents(client, req.ctx.tenant!.id, Number.isFinite(limit) ? limit : 20),
      );
      ok(res, events);
    },
  );

  // ── Sessions ──────────────────────────────────────────────────────────────
  router.get('/promptpay/sessions', requirePermission('payments.read'), async (req, res) => {
    const query = promptpaySessionQuerySchema.parse(req.query);
    const result = await req.ctx.withDb((client) =>
      listPromptPaySessions(client, req.ctx, query),
    );
    ok(res, result.rows, result.meta);
  });

  router.post('/promptpay/sessions', requirePermission('sales.create'), async (req, res) => {
    if (!req.ctx.store) throw new NexoraError('AUTH_STORE_FORBIDDEN');
    const input = promptpaySessionCreateSchema.parse(req.body);
    const session = await req.ctx.withDb((client) =>
      createPromptPaySession(client, req.ctx, input, {
        includePayload: debugPayloadEnabled(),
      }),
    );
    created(res, session);
  });

  router.get('/promptpay/sessions/:id', requirePermission('payments.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const session = await req.ctx.withDb((client) =>
      getPromptPaySession(client, req.ctx, id, { includePayload: debugPayloadEnabled() }),
    );
    ok(res, session);
  });

  router.post(
    '/promptpay/sessions/:id/confirm',
    requirePermission('payments.confirm'),
    async (req, res) => {
      const id = uuidSchema.parse(req.params.id);
      const input = promptpayConfirmSchema.parse(req.body);
      const result = await req.ctx.withDb((client) =>
        confirmPromptPaySession(client, req.ctx, id, input),
      );
      // The expiry transition must commit before we report the 409.
      if (result.status === 'expired') throw new NexoraError('DOMAIN_PROMPTPAY_EXPIRED');
      ok(res, result.session, { alreadyVerified: result.alreadyVerified });
    },
  );

  router.post(
    '/promptpay/sessions/:id/cancel',
    requirePermission('payments.confirm'),
    async (req, res) => {
      const id = uuidSchema.parse(req.params.id);
      const input = promptpayCancelSchema.parse(req.body);
      const session = await req.ctx.withDb((client) =>
        cancelPromptPaySession(client, req.ctx, id, input),
      );
      ok(res, session);
    },
  );

  router.post(
    '/promptpay/sessions/:id/regenerate',
    requirePermission('payments.confirm'),
    async (req, res) => {
      const id = uuidSchema.parse(req.params.id);
      const session = await req.ctx.withDb((client) =>
        regeneratePromptPaySession(client, req.ctx, id, {
          includePayload: debugPayloadEnabled(),
        }),
      );
      ok(res, session);
    },
  );

  return router;
}

const webhookEventSchema = z.object({
  eventId: z.string().trim().min(8).max(120),
  type: z.literal('payment.received'),
  reference: z.string().trim().min(4).max(40),
  amountSatang: z.number().int().min(1),
  currency: z.literal('THB'),
  transactionRef: z.string().trim().max(120).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  storeId: uuidSchema.optional(),
});

/**
 * Public, signature-verified webhook receiver. It is not a bank API: a real
 * provider must be contracted and configured to call this endpoint.
 */
export function paymentWebhookRoutes(db: Db): Router {
  const router = Router();

  router.post('/promptpay/:publicId', async (req, res) => {
    const publicId = String(req.params.publicId ?? '');
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8');
    if (!rawBody) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw body unavailable',
          messageTh: 'ไม่พบข้อมูลที่ส่งมา',
          messageEn: 'Raw body unavailable.',
          retryable: false,
        },
      });
      return;
    }

    let event: z.infer<typeof webhookEventSchema>;
    try {
      event = webhookEventSchema.parse(req.body);
    } catch {
      res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid event payload',
          messageTh: 'รูปแบบเหตุการณ์ไม่ถูกต้อง',
          messageEn: 'Invalid event payload.',
          retryable: false,
        },
      });
      return;
    }

    const headerEventId = String(req.headers['x-nexora-event-id'] ?? '');
    if (headerEventId !== event.eventId) {
      res.status(401).json({
        error: {
          code: 'AUTH_PERMISSION_DENIED',
          message: 'Event id mismatch',
          messageTh: 'ข้อมูลเหตุการณ์ไม่ตรงกับลายเซ็น',
          messageEn: 'Event id mismatch.',
          retryable: false,
        },
      });
      return;
    }

    const config = await db.withPlatformAdmin(async (client) => {
      const result = await client.query<{
        id: string;
        tenant_id: string;
        secret_encrypted: string;
        is_active: boolean;
      }>(
        `SELECT id, tenant_id, secret_encrypted, is_active
         FROM payment_provider_configs
         WHERE public_id = $1`,
        [publicId],
      );
      return result.rows[0] ?? null;
    });
    if (!config || !config.is_active) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Webhook not found',
          messageTh: 'ไม่พบปลายทาง webhook นี้',
          messageEn: 'Webhook endpoint not found.',
          retryable: false,
        },
      });
      return;
    }

    const signature = String(req.headers['x-nexora-signature'] ?? '');
    const timestamp = String(req.headers['x-nexora-timestamp'] ?? '');
    const verified = verifyWebhookSignature({
      secret: decryptSecret(config.secret_encrypted),
      rawBody,
      timestamp,
      signature,
    });
    if (!verified.valid) {
      res.status(401).json({
        error: {
          code: 'AUTH_PERMISSION_DENIED',
          message: 'Invalid signature',
          messageTh: 'ลายเซ็น webhook ไม่ถูกต้อง',
          messageEn: 'Invalid webhook signature.',
          retryable: false,
        },
      });
      return;
    }

    const result = await processWebhookEvent(
      db,
      config.id,
      config.tenant_id,
      event,
      rawBody,
    );
    res.status(200).json({ data: result });
  });

  return router;
}
