import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { NexoraError } from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { created } from '../http/respond';
import { writeAudit } from '../services/audit';

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

const MAX_BYTES = 1_300_000;

const FORMATS: Record<string, { ext: string; magic: number[] }> = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};

export function uploadRoutes(): Router {
  const router = Router();

  router.post('/uploads/product-image', requirePermission('products.update'), async (req, res) => {
    const input = z
      .object({
        mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        dataBase64: z.string().min(32).max(1_800_000),
      })
      .parse(req.body);

    const format = FORMATS[input.mimeType]!;
    const data = Buffer.from(input.dataBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
      throw new NexoraError('VALIDATION_FAILED', { reason: 'image_size', maxBytes: MAX_BYTES });
    }
    if (!format.magic.every((byte, index) => data[index] === byte)) {
      throw new NexoraError('VALIDATION_FAILED', { reason: 'image_signature' });
    }
    if (input.mimeType === 'image/webp') {
      const marker = data.subarray(8, 12).toString('ascii');
      if (marker !== 'WEBP') throw new NexoraError('VALIDATION_FAILED', { reason: 'image_signature' });
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}.${format.ext}`;
    await writeFile(path.join(UPLOAD_DIR, filename), data, { flag: 'wx' });

    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store?.id ?? null,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'product.image_uploaded',
        entityType: 'upload',
        entityId: filename,
        after: { bytes: data.byteLength, mimeType: input.mimeType },
        correlationId: ctx.correlationId,
      });
    });

    created(res, { url: `/uploads/${filename}`, bytes: data.byteLength, mimeType: input.mimeType });
  });

  return router;
}
