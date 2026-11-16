import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
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
