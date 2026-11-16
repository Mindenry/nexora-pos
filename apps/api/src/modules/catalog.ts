import { Router } from 'express';
import type { DbClient } from '@nexora/db';
import {
  NexoraError,
  parseMoneyToSatang,
  productInputSchema,
  categoryInputSchema,
  brandInputSchema,
  unitInputSchema,
  listQuerySchema,
  uuidSchema,
} from '@nexora/shared';
import { z } from 'zod';
import { requirePermission } from '../http/auth';
import { ok, created, csv } from '../http/respond';
import { getProductDetail, listProducts, type ProductFilters } from '../services/catalog';
import { writeAudit } from '../services/audit';
function mapVariant(v: any) {
  return {
    id: v.id,
    name: v.name,
    sku: v.sku,
    barcode: v.barcode,
    priceSatang: Number(v.price_satang ?? v.priceSatang ?? 0),
    costSatang: Number(v.cost_satang ?? v.costSatang ?? 0),
    compareAtSatang: v.compare_at_satang != null ? Number(v.compare_at_satang) : null,
    attributes: v.attributes ?? {},
    isDefault: Boolean(v.is_default ?? v.isDefault),
    status: v.status ?? 'active',
    onHand: Number(v.on_hand ?? v.onHand ?? 0),
    extraBarcodes: v.extra_barcodes ?? [],
  };
}

function mapProduct(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    status: row.status,
    type: row.type,
    imageUrl: row.image_url ?? '',
    categoryId: row.category_id ?? null,
    categoryName: row.category_name ?? null,
    brandId: row.brand_id ?? null,
    brandName: row.brand_name ?? null,
    unitId: row.unit_id ?? null,
    unitCode: row.unit_code ?? null,
    taxRateBp: row.tax_rate_bp ?? null,
    trackInventory: Boolean(row.track_inventory),
    reorderPoint: Number(row.reorder_point ?? 0),
    minPriceSatang: Number(row.min_price ?? 0),
    maxPriceSatang: Number(row.max_price ?? 0),
    onHand: Number(row.on_hand ?? 0),
    variants: (row.variants ?? []).map(mapVariant),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function ensureCategory(client: DbClient, tenantId: string, name: string): Promise<string | null> {
  if (!name.trim()) return null;
  const found = await client.query<{ id: string }>(
    'SELECT id FROM categories WHERE tenant_id = $1 AND lower(name) = lower($2)',
    [tenantId, name.trim()],
  );
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    'INSERT INTO categories (tenant_id, name) VALUES ($1,$2) RETURNING id',
    [tenantId, name.trim()],
  );
  return inserted.rows[0]!.id;
}

export function catalogRoutes(): Router {
  const router = Router();

  router.get('/products', requirePermission('products.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const status = req.query.status as ProductFilters['status'] | undefined;
    const filters: ProductFilters = {
      ...query,
      status: status ?? (query.includeInactive ? undefined : 'active'),
      categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
      lowStock: req.query.lowStock === 'true',
    };
    const result = await ctx.withDb((client) =>
      listProducts(client, ctx.tenant!.id, ctx.store?.id ?? null, filters),
    );
    ok(
      res,
      result.rows.map(mapProduct),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      },
    );
  });

  router.get('/products/export.csv', requirePermission('products.read'), async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb(async (client) => {
      const result = await client.query(
        `SELECT p.name, v.sku, v.barcode, c.name AS category,
                v.price_satang, v.cost_satang, p.status
         FROM products p
         JOIN product_variants v ON v.product_id = p.id AND v.is_default
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.tenant_id = $1
         ORDER BY p.name`,
        [ctx.tenant!.id],
      );
      return result.rows;
    });
    const header = 'name,sku,barcode,category,price,cost,status';
    const lines = rows.map((r: any) =>
      [r.name, r.sku ?? '', r.barcode ?? '', r.category ?? '', r.price_satang / 100, r.cost_satang / 100, r.status]
        .map((v) => csvEscape(String(v)))
        .join(','),
    );
    csv(res, 'nexora-products.csv', [header, ...lines].join('\n'));
  });

  router.post('/products/import', requirePermission('products.create'), async (req, res) => {
    const input = z.object({ csv: z.string().min(1).max(2_000_000) }).parse(req.body);
    const ctx = req.ctx;
    const rows = parseCsv(input.csv);
    if (rows.length < 2) throw new NexoraError('VALIDATION_FAILED', { reason: 'empty_csv' });
    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const index = (name: string) => header.indexOf(name);
    const required = ['name', 'price', 'cost'];
    for (const key of required) {
      if (index(key) < 0) throw new NexoraError('VALIDATION_FAILED', { reason: `missing_${key}` });
    }

    const outcome = await ctx.withDb(async (client) => {
      let imported = 0;
      const errors: Array<{ row: number; message: string }> = [];
      for (let i = 1; i < rows.length; i += 1) {
        const cells = rows[i]!;
        const get = (key: string) => (index(key) >= 0 ? (cells[index(key)] ?? '').trim() : '');
        const name = get('name');
        const price = parseMoneyToSatang(get('price'));
        const cost = parseMoneyToSatang(get('cost'));
        if (!name || price === null || cost === null) {
          errors.push({ row: i + 1, message: 'INVALID_ROW' });
          continue;
        }
        const categoryId = await ensureCategory(client, ctx.tenant!.id, get('category'));
        const sku = get('sku') || null;
        const barcode = get('barcode') || null;
        const existing = sku
          ? await client.query<{ id: string; variant_id: string }>(
              `SELECT p.id, v.id AS variant_id FROM products p
               JOIN product_variants v ON v.product_id = p.id AND v.is_default
               WHERE p.tenant_id = $1 AND v.sku = $2`,
              [ctx.tenant!.id, sku],
            )
          : null;
        if (existing?.rows[0]) {
          const row = existing.rows[0];
          await client.query(
            `UPDATE products SET name=$1, category_id=$2, status='active', updated_at=now()
             WHERE tenant_id=$3 AND id=$4`,
            [name, categoryId, ctx.tenant!.id, row.id],
          );
          await client.query(
            `UPDATE product_variants SET price_satang=$1, cost_satang=$2, barcode=COALESCE($3, barcode),
             name=$4, updated_at=now() WHERE tenant_id=$5 AND id=$6`,
            [price, cost, barcode, name, ctx.tenant!.id, row.variant_id],
          );
        } else {
          const product = await client.query<{ id: string }>(
            `INSERT INTO products (tenant_id, name, category_id, status) VALUES ($1,$2,$3,'active') RETURNING id`,
            [ctx.tenant!.id, name, categoryId],
          );
          await client.query(
            `INSERT INTO product_variants
              (tenant_id, product_id, name, sku, barcode, price_satang, cost_satang, is_default)
             VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
            [ctx.tenant!.id, product.rows[0]!.id, name, sku, barcode, price, cost],
          );
        }
        imported += 1;
      }
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'products.imported',
        entityType: 'product',
        after: { imported, errors: errors.length },
        correlationId: ctx.correlationId,
      });
      return { imported, errors };
    });
    ok(res, outcome);
  });

  router.get('/products/:id', requirePermission('products.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const detail = await ctx.withDb((client) =>
      getProductDetail(client, ctx.tenant!.id, ctx.store?.id ?? null, id),
    );
    if (!detail) throw new NexoraError('NOT_FOUND');
    ok(res, {
      ...mapProduct(detail),
      variants: (detail as any).variants.map(mapVariant),
    });
  });

  router.post('/products', requirePermission('products.create'), async (req, res) => {
    const input = productInputSchema.parse(req.body);
    const ctx = req.ctx;
    const product = await ctx.withDb(async (client) => {
      const variants =
        input.type === 'variable'
          ? (input.variants ?? [])
          : [
              {
                name: 'มาตรฐาน',
                sku: input.sku || '',
                barcode: input.barcode || '',
                priceSatang: input.priceSatang,
                costSatang: input.costSatang,
                isDefault: true,
              },
            ];
      if (variants.length === 0) throw new NexoraError('VALIDATION_FAILED', { field: 'variants' });

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO products
          (tenant_id, category_id, brand_id, unit_id, name, description, image_url, type,
           tax_rate_bp, track_inventory, reorder_point, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          ctx.tenant!.id,
          input.categoryId ?? null,
          input.brandId ?? null,
          input.unitId ?? null,
          input.name,
          input.description || '',
          input.imageUrl || '',
          input.type,
          input.taxRateBp ?? null,
          input.trackInventory,
          input.reorderPoint,
          input.status,
        ],
      );
      const productId = inserted.rows[0]!.id;
      let firstVariantId = '';
      for (const [i, variant] of variants.entries()) {
        const isDefault = variant.isDefault ?? i === 0;
        const row = await client.query<{ id: string }>(
          `INSERT INTO product_variants
            (tenant_id, product_id, name, sku, barcode, price_satang, cost_satang,
             compare_at_satang, attributes, is_default)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING id`,
          [
            ctx.tenant!.id,
            productId,
            variant.name,
            variant.sku || null,
            variant.barcode || null,
            variant.priceSatang,
            variant.costSatang,
            input.compareAtSatang ?? null,
            JSON.stringify(variant.attributes ?? {}),
            isDefault,
          ],
        );
        if (!firstVariantId) firstVariantId = row.rows[0]!.id;
      }
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store?.id ?? null,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'product.created',
        entityType: 'product',
        entityId: productId,
        after: { name: input.name, priceSatang: input.priceSatang, variants: variants.length },
        correlationId: ctx.correlationId,
      });
      return { id: productId, variantId: firstVariantId };
    });
    created(res, product);
  });

  router.put('/products/:id', requirePermission('products.update'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = productInputSchema.parse(req.body);
    const ctx = req.ctx;

    await ctx.withDb(async (client) => {
      const before = await client.query('SELECT * FROM products WHERE tenant_id=$1 AND id=$2', [
        ctx.tenant!.id,
        id,
      ]);
      if (!before.rows[0]) throw new NexoraError('NOT_FOUND');
      await client.query(
        `UPDATE products SET category_id=$1, brand_id=$2, unit_id=$3, name=$4, description=$5,
          image_url=$6, type=$7, tax_rate_bp=$8, track_inventory=$9, reorder_point=$10,
          status=$11, archived_at = CASE WHEN $11 = 'archived' THEN COALESCE(archived_at, now()) ELSE NULL END,
          updated_at=now()
         WHERE tenant_id=$12 AND id=$13`,
        [
          input.categoryId ?? null,
          input.brandId ?? null,
          input.unitId ?? null,
          input.name,
          input.description || '',
          input.imageUrl || '',
          input.type,
          input.taxRateBp ?? null,
          input.trackInventory,
          input.reorderPoint,
          input.status,
          ctx.tenant!.id,
          id,
        ],
      );

      if (input.type === 'simple') {
        const defaultVariant = await client.query<{ id: string }>(
          `SELECT id FROM product_variants WHERE product_id=$1 AND is_default ORDER BY created_at LIMIT 1`,
          [id],
        );
        if (defaultVariant.rows[0]) {
          await client.query(
            `UPDATE product_variants SET name=$1, sku=$2, barcode=$3, price_satang=$4,
               cost_satang=$5, compare_at_satang=$6, updated_at=now()
             WHERE tenant_id=$7 AND id=$8`,
            [
              'มาตรฐาน',
              input.sku || null,
              input.barcode || null,
              input.priceSatang,
              input.costSatang,
              input.compareAtSatang ?? null,
              ctx.tenant!.id,
              defaultVariant.rows[0].id,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO product_variants
              (tenant_id, product_id, name, sku, barcode, price_satang, cost_satang, is_default)
             VALUES ($1,$2,'มาตรฐาน',$3,$4,$5,$6,true)`,
            [ctx.tenant!.id, id, input.sku || null, input.barcode || null, input.priceSatang, input.costSatang],
          );
        }
      } else {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM product_variants WHERE product_id=$1',
          [id],
        );
        const keep = new Set<string>();
        for (const [i, variant] of (input.variants ?? []).entries()) {
          if (!variant) continue;
          const isDefault = variant.isDefault ?? i === 0;
          if (variant.id) {
            keep.add(variant.id);
            await client.query(
              `UPDATE product_variants SET name=$1, sku=$2, barcode=$3, price_satang=$4,
                 cost_satang=$5, attributes=$6::jsonb, is_default=$7, status='active', updated_at=now()
               WHERE tenant_id=$8 AND id=$9 AND product_id=$10`,
              [
                variant.name,
                variant.sku || null,
                variant.barcode || null,
                variant.priceSatang,
                variant.costSatang,
                JSON.stringify(variant.attributes ?? {}),
                isDefault,
                ctx.tenant!.id,
                variant.id,
                id,
              ],
            );
          } else {
            await client.query(
              `INSERT INTO product_variants
                (tenant_id, product_id, name, sku, barcode, price_satang, cost_satang, attributes, is_default)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
              [
                ctx.tenant!.id,
                id,
                variant.name,
                variant.sku || null,
                variant.barcode || null,
                variant.priceSatang,
                variant.costSatang,
                JSON.stringify(variant.attributes ?? {}),
                isDefault,
              ],
            );
          }
        }
        for (const row of existing.rows) {
          if (!keep.has(row.id)) {
            await client.query(`UPDATE product_variants SET status='archived' WHERE id=$1`, [row.id]);
          }
        }
      }

      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store?.id ?? null,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'product.updated',
        entityType: 'product',
        entityId: id,
        before: before.rows[0],
        after: { name: input.name, priceSatang: input.priceSatang, status: input.status },
        correlationId: ctx.correlationId,
      });
    });
    ok(res, { id });
  });

  router.post('/products/:id/archive', requirePermission('products.delete'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      const updated = await client.query(
        `UPDATE products SET status='archived', archived_at=now(), updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING id`,
        [ctx.tenant!.id, id],
      );
      if (!updated.rowCount) throw new NexoraError('NOT_FOUND');
      await client.query('UPDATE product_variants SET status=\'archived\' WHERE product_id=$1', [id]);
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'product.archived',
        entityType: 'product',
        entityId: id,
        correlationId: ctx.correlationId,
      });
    });
    res.status(204).end();
  });

  router.post('/variants/:id/barcodes', requirePermission('products.update'), async (req, res) => {
    const variantId = uuidSchema.parse(req.params.id);
    const body = z.object({ barcode: z.string().trim().min(3).max(60) }).parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const variant = await client.query('SELECT id FROM product_variants WHERE tenant_id=$1 AND id=$2', [
        ctx.tenant!.id,
        variantId,
      ]);
      if (!variant.rowCount) throw new NexoraError('NOT_FOUND');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO product_barcodes (tenant_id, variant_id, barcode) VALUES ($1,$2,$3) RETURNING id`,
        [ctx.tenant!.id, variantId, body.barcode],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'product.barcode_added',
        entityType: 'product_variant',
        entityId: variantId,
        after: { barcode: body.barcode },
        correlationId: ctx.correlationId,
      });
      return inserted.rows[0]!;
    });
    created(res, row);
  });

  router.delete('/barcodes/:id', requirePermission('products.update'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      const deleted = await client.query(
        'DELETE FROM product_barcodes WHERE tenant_id=$1 AND id=$2 RETURNING id',
        [ctx.tenant!.id, id],
      );
      if (!deleted.rowCount) throw new NexoraError('NOT_FOUND');
    });
    res.status(204).end();
  });

  router.get('/categories', requirePermission('products.read'), async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT c.id, c.name, c.parent_id, c.sort_order,
                (SELECT count(*)::bigint FROM products p WHERE p.category_id=c.id AND p.status='active') AS product_count
         FROM categories c WHERE c.tenant_id=$1 ORDER BY c.sort_order, c.name`,
        [ctx.tenant!.id],
      ),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        parentId: r.parent_id,
        sortOrder: r.sort_order,
        productCount: Number(r.product_count),
      })),
    );
  });

  router.post('/categories', requirePermission('products.create'), async (req, res) => {
    const input = categoryInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const inserted = await client.query(
        `INSERT INTO categories (tenant_id, name, parent_id, sort_order) VALUES ($1,$2,$3,$4)
         RETURNING id, name, parent_id, sort_order`,
        [ctx.tenant!.id, input.name, input.parentId ?? null, input.sortOrder],
      );
      return inserted.rows[0];
    });
    created(res, row);
  });

  router.patch('/categories/:id', requirePermission('products.update'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = categoryInputSchema.partial().parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const updated = await client.query(
        `UPDATE categories SET
           name = COALESCE($1, name),
           parent_id = COALESCE($2, parent_id),
           sort_order = COALESCE($3, sort_order)
         WHERE tenant_id=$4 AND id=$5 RETURNING id, name, parent_id, sort_order`,
        [input.name ?? null, input.parentId ?? null, input.sortOrder ?? null, ctx.tenant!.id, id],
      );
      if (!updated.rowCount) throw new NexoraError('NOT_FOUND');
      return updated.rows[0];
    });
    ok(res, row);
  });

  router.delete('/categories/:id', requirePermission('products.update'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      const used = await client.query(
        'SELECT 1 FROM products WHERE tenant_id=$1 AND category_id=$2 LIMIT 1',
        [ctx.tenant!.id, id],
      );
      if (used.rowCount) throw new NexoraError('CONFLICT_DUPLICATE', { reason: 'category_in_use' });
      const deleted = await client.query('DELETE FROM categories WHERE tenant_id=$1 AND id=$2', [
        ctx.tenant!.id,
        id,
      ]);
      if (!deleted.rowCount) throw new NexoraError('NOT_FOUND');
    });
    res.status(204).end();
  });

  router.get('/brands', requirePermission('products.read'), async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb((client) =>
      client.query('SELECT id, name FROM brands WHERE tenant_id=$1 ORDER BY name', [ctx.tenant!.id]),
    );
    ok(res, rows.rows);
  });

  router.post('/brands', requirePermission('products.create'), async (req, res) => {
    const input = brandInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const inserted = await client.query(
        'INSERT INTO brands (tenant_id, name) VALUES ($1,$2) RETURNING id, name',
        [ctx.tenant!.id, input.name],
      );
      return inserted.rows[0];
    });
    created(res, row);
  });

  router.delete('/brands/:id', requirePermission('products.update'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      const used = await client.query('SELECT 1 FROM products WHERE brand_id=$1 LIMIT 1', [id]);
      if (used.rowCount) throw new NexoraError('CONFLICT_DUPLICATE', { reason: 'brand_in_use' });
      await client.query('UPDATE products SET brand_id=NULL WHERE brand_id=$1', [id]).catch(() => undefined);
      const deleted = await client.query('DELETE FROM brands WHERE tenant_id=$1 AND id=$2', [
        ctx.tenant!.id,
        id,
      ]);
      if (!deleted.rowCount) throw new NexoraError('NOT_FOUND');
    });
    res.status(204).end();
  });

  router.get('/units', requirePermission('products.read'), async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb((client) =>
      client.query('SELECT id, code, name FROM units WHERE tenant_id=$1 ORDER BY code', [ctx.tenant!.id]),
    );
    ok(res, rows.rows.map((r: any) => ({ id: r.id, code: r.code, name: r.name })));
  });

  router.post('/units', requirePermission('products.create'), async (req, res) => {
    const input = unitInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const inserted = await client.query(
        'INSERT INTO units (tenant_id, code, name) VALUES ($1,$2,$3) RETURNING id, code, name',
        [ctx.tenant!.id, input.code.toLowerCase(), input.name],
      );
      return inserted.rows[0];
    });
    created(res, row);
  });

  return router;
}
