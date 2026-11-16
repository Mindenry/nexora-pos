import type { DbClient } from '@nexora/db';
import {
  NexoraError,
  businessDateOf,
  divRoundHalfUp,
  type RefundInput,
  type VoidSaleInput,
} from '@nexora/shared';
import type { RequestContext } from '../types';
import { writeAudit } from './audit';
import { appendMovement } from './inventory';
import { runIdempotent } from './idempotency';
import { allocateDocumentNumber } from './numbering';

interface SaleRow {
  id: string;
  number: string;
  store_id: string;
  shift_id: string;
  employee_id: string;
  customer_id: string | null;
  status: string;
  subtotal_satang: number;
  discount_satang: number;
  tax_satang: number;
  total_satang: number;
  cost_satang: number;
  refunded_satang: number;
  points_redeemed: number;
  points_discount_satang: number;
  business_date: string;
  occurred_at: string;
  receipt_snapshot: any;
}

interface SaleItemRow {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  qty: number;
  unit_price_satang: number;
  unit_cost_satang: number;
  tax_satang: number;
  line_total_satang: number;
  cost_satang: number;
  refunded_qty: number;
}

export interface RefundResult {
  refundId: string;
  number: string;
  originalNumber: string;
  totalSatang: number;
  taxSatang: number;
  restock: boolean;
  method: string;
  receipt: Record<string, unknown>;
  replayed?: boolean;
}

async function lockedSale(client: DbClient, tenantId: string, saleId: string): Promise<SaleRow> {
  const result = await client.query<SaleRow>(
    'SELECT * FROM sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [tenantId, saleId],
  );
  const sale = result.rows[0];
  if (!sale) throw new NexoraError('NOT_FOUND', { entity: 'sale' });
  return sale;
}

async function originalCash(client: DbClient, tenantId: string, saleId: string): Promise<number> {
  const result = await client.query<{ cash: number }>(
    `SELECT COALESCE(sum(amount_satang),0)::bigint AS cash FROM payments
     WHERE tenant_id=$1 AND sale_id=$2 AND method='cash'
       AND status IN ('paid','partially_refunded','refunded')`,
    [tenantId, saleId],
  );
  return Number(result.rows[0]?.cash ?? 0);
}

export async function performRefund(
  client: DbClient,
  ctx: RequestContext,
  input: RefundInput,
): Promise<RefundResult> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;
  const business = ctx.business!;

  const result = await runIdempotent(
    client,
    { tenantId, operationId: input.operationId, scope: 'sale.refund', payload: input },
    async () => {
      const sale = await lockedSale(client, tenantId, input.saleId);
      if (sale.store_id !== store.id) throw new NexoraError('AUTH_STORE_FORBIDDEN');
      if (!['completed', 'partially_refunded'].includes(sale.status)) {
        throw new NexoraError('DOMAIN_SALE_IMMUTABLE', { reason: 'sale_not_refundable' });
      }

      const shift = await client.query<{ id: string }>(
        `SELECT id FROM shifts
         WHERE tenant_id=$1 AND store_id=$2 AND employee_id=$3 AND status='open' FOR UPDATE`,
        [tenantId, store.id, ctx.employee!.id],
      );
      if (!shift.rows[0]) throw new NexoraError('DOMAIN_SHIFT_NOT_OPEN');

      const itemsResult = await client.query<SaleItemRow>(
        'SELECT * FROM sale_items WHERE tenant_id=$1 AND sale_id=$2 FOR UPDATE',
        [tenantId, input.saleId],
      );
      const itemMap = new Map(itemsResult.rows.map((r) => [r.id, r]));

      const refundedAmounts = await client.query<{
        sale_item_id: string;
        amount: number;
        cost: number;
      }>(
        `SELECT ri.sale_item_id,
                COALESCE(sum(ri.amount_satang),0)::bigint AS amount,
                COALESCE(sum(ri.cost_satang),0)::bigint AS cost
         FROM refund_items ri
         JOIN refunds r ON r.id = ri.refund_id
         WHERE r.tenant_id=$1 AND r.sale_id=$2 AND r.status='completed'
         GROUP BY ri.sale_item_id`,
        [tenantId, input.saleId],
      );
      const already = new Map(
        refundedAmounts.rows.map((r) => [r.sale_item_id, { amount: Number(r.amount), cost: Number(r.cost) }]),
      );

      const lines: Array<{
        item: SaleItemRow;
        qty: number;
        amountSatang: number;
        costSatang: number;
        taxSatang: number;
      }> = [];
      const seen = new Set<string>();
      for (const requested of input.items) {
        if (seen.has(requested.saleItemId)) {
          throw new NexoraError('VALIDATION_FAILED', { reason: 'duplicate_item' });
        }
        seen.add(requested.saleItemId);
        const item = itemMap.get(requested.saleItemId);
        if (!item) throw new NexoraError('NOT_FOUND', { entity: 'sale_item' });
        const remainingQty = item.qty - item.refunded_qty;
        if (requested.qty > remainingQty) throw new NexoraError('DOMAIN_REFUND_EXCEEDS', { saleItemId: item.id });
        const prior = already.get(item.id) ?? { amount: 0, cost: 0 };
        const remainingAmount = Number(item.line_total_satang) - prior.amount;
        const remainingCost = Number(item.cost_satang) - prior.cost;
        const full = requested.qty === remainingQty;
        const amount = full
          ? remainingAmount
          : Math.min(remainingAmount, divRoundHalfUp(Number(item.line_total_satang) * requested.qty, item.qty));
        const cost = full
          ? remainingCost
          : Math.min(remainingCost, divRoundHalfUp(Number(item.cost_satang) * requested.qty, item.qty));
        const tax = full
          ? Math.max(0, Number(item.tax_satang) - divRoundHalfUp(Number(item.tax_satang) * item.refunded_qty, item.qty))
          : divRoundHalfUp(Number(item.tax_satang) * requested.qty, item.qty);
        lines.push({ item, qty: requested.qty, amountSatang: amount, costSatang: cost, taxSatang: tax });
      }

      const total = lines.reduce((sum, l) => sum + l.amountSatang, 0);
      const totalCost = lines.reduce((sum, l) => sum + l.costSatang, 0);
      const totalTax = lines.reduce((sum, l) => sum + l.taxSatang, 0);
      if (total <= 0) throw new NexoraError('DOMAIN_REFUND_EXCEEDS', { reason: 'zero_value' });
      if (Number(sale.refunded_satang) + total > Number(sale.total_satang)) {
        throw new NexoraError('DOMAIN_REFUND_EXCEEDS', { reason: 'sale_total' });
      }

      const cashPaid = await originalCash(client, tenantId, sale.id);
      const cashRefundedResult = await client.query<{ cash: number }>(
        `SELECT COALESCE(sum(amount_satang),0)::bigint AS cash FROM refunds
         WHERE tenant_id=$1 AND sale_id=$2 AND method='cash' AND status='completed'`,
        [tenantId, sale.id],
      );
      const cashRefunded = Number(cashRefundedResult.rows[0]?.cash ?? 0);
      let method = input.method || 'original';
      if (method === 'cash' && total > cashPaid - cashRefunded) {
        throw new NexoraError('DOMAIN_REFUND_EXCEEDS', { reason: 'cash_portions', available: cashPaid - cashRefunded });
      }
      if (method === 'original' && cashPaid > 0 && total <= cashPaid - cashRefunded) {
        method = 'cash';
      }

      const businessDate = businessDateOf(new Date(), store.timezone);
      const number = await allocateDocumentNumber(client, {
        tenantId,
        storeId: store.id,
        docType: 'refund',
        period: businessDate,
        prefix: 'RF',
      });

      const snapshot = {
        type: 'refund',
        number,
        originalNumber: sale.number,
        businessDate,
        issuedAt: new Date().toISOString(),
        business: {
          name: business.name,
          legalName: business.legalName,
          taxId: business.taxId,
          address: business.address,
          phone: business.phone,
        },
        store: { name: store.name, code: store.code, address: store.address, phone: store.phone },
        cashier: ctx.employee!.displayName,
        reason: input.reason,
        items: lines.map((l) => ({
          name: `${l.item.product_name}${l.item.variant_name && l.item.variant_name !== 'มาตรฐาน' ? ` · ${l.item.variant_name}` : ''}`,
          sku: l.item.sku,
          qty: l.qty,
          amountSatang: l.amountSatang,
        })),
        totalSatang: total,
        taxSatang: totalTax,
        method,
        restock: input.restock,
      };

      const refund = await client.query<{ id: string }>(
        `INSERT INTO refunds
          (tenant_id, sale_id, store_id, shift_id, number, original_number, status,
           amount_satang, cost_satang, tax_satang, reason, restock, method, created_by,
           operation_id, receipt_snapshot, business_date)
         VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
         RETURNING id`,
        [
          tenantId,
          sale.id,
          store.id,
          shift.rows[0].id,
          number,
          sale.number,
          total,
          totalCost,
          totalTax,
          input.reason,
          input.restock,
          method,
          ctx.employee!.id,
          input.operationId,
          JSON.stringify(snapshot),
          businessDate,
        ],
      );
      const refundId = refund.rows[0]!.id;

      for (const line of lines) {
        await client.query(
          `INSERT INTO refund_items
            (tenant_id, refund_id, sale_item_id, variant_id, qty, amount_satang, cost_satang)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, refundId, line.item.id, line.item.variant_id, line.qty, line.amountSatang, line.costSatang],
        );
        await client.query('UPDATE sale_items SET refunded_qty = refunded_qty + $1 WHERE id=$2', [
          line.qty,
          line.item.id,
        ]);
        if (input.restock) {
          await appendMovement(client, {
            tenantId,
            storeId: store.id,
            variantId: line.item.variant_id,
            type: 'sales_return',
            qtyDelta: line.qty,
            unitCostSatang: Math.round(line.costSatang / line.qty),
            referenceType: 'refund',
            referenceId: refundId,
            reason: input.reason,
            createdBy: ctx.user.id,
          });
        }
      }

      const newRefunded = Number(sale.refunded_satang) + total;
      const newStatus = newRefunded >= Number(sale.total_satang) ? 'refunded' : 'partially_refunded';
      await client.query('UPDATE sales SET refunded_satang=$1, status=$2 WHERE id=$3', [
        newRefunded,
        newStatus,
        sale.id,
      ]);

      if (method === 'cash') {
        await client.query(
          `INSERT INTO cash_movements
            (tenant_id, store_id, shift_id, employee_id, type, amount_satang, reason, reference_type, reference_id)
           VALUES ($1,$2,$3,$4,'refund_cash',$5,$6,'refund',$7)`,
          [tenantId, store.id, shift.rows[0].id, ctx.employee!.id, -total, input.reason, refundId],
        );
      }

      await client.query(
        `UPDATE payments SET status = CASE
           WHEN $1::bigint >= $2::bigint THEN 'refunded'
           ELSE 'partially_refunded' END
         WHERE tenant_id=$3 AND sale_id=$4 AND status IN ('paid','partially_refunded')`,
        [newRefunded, sale.total_satang, tenantId, sale.id],
      );
      if (newStatus === 'refunded') {
        await client.query(
          `UPDATE payment_sessions SET status = 'refunded'
           WHERE tenant_id = $1 AND sale_id = $2 AND status = 'paid'`,
          [tenantId, sale.id],
        );
        await client.query(
          `UPDATE payment_transactions SET status = 'refunded'
           WHERE tenant_id = $1 AND sale_id = $2 AND status = 'verified'`,
          [tenantId, sale.id],
        );
      }

      if (sale.customer_id) {
        await client.query(
          `UPDATE customers SET total_spent_satang = GREATEST(0, total_spent_satang - $1), updated_at=now()
           WHERE tenant_id=$2 AND id=$3`,
          [total, tenantId, sale.customer_id],
        );
        const points = Math.floor(total / 10_000) * business.loyaltyEarnPerBaht;
        if (points > 0) {
          await client.query(
            `INSERT INTO loyalty_ledger (tenant_id, customer_id, sale_id, points_delta, type, reason)
             VALUES ($1,$2,$3,$4,'adjust',$5)`,
            [tenantId, sale.customer_id, sale.id, -points, `Refund ${number}`],
          );
        }
        if (Number(sale.points_redeemed) > 0) {
          const restored = await client.query<{ restored: number }>(
            `SELECT COALESCE(sum(points_delta),0)::bigint AS restored FROM loyalty_ledger
             WHERE tenant_id=$1 AND sale_id=$2 AND type='adjust' AND reason LIKE 'Points restored%'`,
            [tenantId, sale.id],
          );
          const target = Math.round((Number(sale.points_redeemed) * newRefunded) / Number(sale.total_satang));
          const toRestore = Math.max(0, target - Number(restored.rows[0]?.restored ?? 0));
          if (toRestore > 0) {
            await client.query(
              `INSERT INTO loyalty_ledger (tenant_id, customer_id, sale_id, points_delta, type, reason)
               VALUES ($1,$2,$3,$4,'adjust',$5)`,
              [tenantId, sale.customer_id, sale.id, toRestore, `Points restored (refund ${number})`],
            );
          }
        }
      }

      await client.query(
        `INSERT INTO notifications (tenant_id, store_id, type, severity, title, body, link)
         VALUES ($1,$2,'refund','info',$3,$4,$5)`,
        [
          tenantId,
          store.id,
          `คืนสินค้า ${number}`,
          `บิล ${sale.number} คืน ${(total / 100).toFixed(2)} บาท`,
          `/sales/${sale.id}`,
        ],
      );

      await writeAudit(client, {
        tenantId,
        storeId: store.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'sale.refunded',
        entityType: 'refund',
        entityId: refundId,
        before: { saleNumber: sale.number, refundedSatang: sale.refunded_satang },
        after: { amountSatang: total, method, restock: input.restock, reason: input.reason },
        reason: input.reason,
        correlationId: ctx.correlationId,
      });

      return {
        refundId,
        number,
        originalNumber: sale.number,
        totalSatang: total,
        taxSatang: totalTax,
        restock: input.restock,
        method,
        receipt: snapshot,
      };
    },
  );

  return { ...result.data, replayed: result.replayed };
}

export interface VoidResult {
  saleId: string;
  number: string;
  status: 'voided';
  reversedSatang: number;
  replayed?: boolean;
}

export async function voidSale(
  client: DbClient,
  ctx: RequestContext,
  saleId: string,
  input: VoidSaleInput,
): Promise<VoidResult> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;
  const result = await runIdempotent(
    client,
    { tenantId, operationId: input.operationId, scope: 'sale.void', payload: { saleId, ...input } },
    async () => {
      const sale = await lockedSale(client, tenantId, saleId);
      if (sale.store_id !== store.id) throw new NexoraError('AUTH_STORE_FORBIDDEN');
      if (sale.status !== 'completed') throw new NexoraError('DOMAIN_SALE_IMMUTABLE', { reason: 'not_completed' });
      if (Number(sale.refunded_satang) > 0) throw new NexoraError('DOMAIN_SALE_IMMUTABLE', { reason: 'has_refunds' });
      const today = businessDateOf(new Date(), store.timezone);
      if (sale.business_date !== today) {
        throw new NexoraError('DOMAIN_SALE_IMMUTABLE', { reason: 'closed_business_date' });
      }
      const shift = await client.query<{ id: string }>(
        `SELECT id FROM shifts
         WHERE tenant_id=$1 AND store_id=$2 AND employee_id=$3 AND status='open' FOR UPDATE`,
        [tenantId, store.id, ctx.employee!.id],
      );
      if (!shift.rows[0]) throw new NexoraError('DOMAIN_SHIFT_NOT_OPEN');

      const items = await client.query<SaleItemRow>(
        'SELECT * FROM sale_items WHERE tenant_id=$1 AND sale_id=$2',
        [tenantId, saleId],
      );
      for (const item of items.rows) {
        await appendMovement(client, {
          tenantId,
          storeId: store.id,
          variantId: item.variant_id,
          type: 'sales_return',
          qtyDelta: item.qty,
          unitCostSatang: Number(item.unit_cost_satang),
          referenceType: 'sale_void',
          referenceId: saleId,
          reason: input.reason,
          createdBy: ctx.user.id,
        });
      }

      const cashPaid = await originalCash(client, tenantId, saleId);
      if (cashPaid > 0) {
        await client.query(
          `INSERT INTO cash_movements
            (tenant_id, store_id, shift_id, employee_id, type, amount_satang, reason, reference_type, reference_id)
           VALUES ($1,$2,$3,$4,'refund_cash',$5,$6,'sale_void',$7)`,
          [tenantId, store.id, shift.rows[0].id, ctx.employee!.id, -cashPaid, input.reason, saleId],
        );
      }
      await client.query(
        `UPDATE payments SET status='refunded' WHERE tenant_id=$1 AND sale_id=$2 AND status IN ('paid','partially_refunded')`,
        [tenantId, saleId],
      );
      await client.query(
        `UPDATE payment_sessions SET status='refunded'
         WHERE tenant_id=$1 AND sale_id=$2 AND status='paid'`,
        [tenantId, saleId],
      );
      await client.query(
        `UPDATE payment_transactions SET status='refunded'
         WHERE tenant_id=$1 AND sale_id=$2 AND status='verified'`,
        [tenantId, saleId],
      );
      await client.query(
        `UPDATE sales SET status='voided', voided_at=now(), voided_by=$1, void_reason=$2 WHERE id=$3`,
        [ctx.user.id, input.reason, saleId],
      );
      if (sale.customer_id) {
        await client.query(
          `UPDATE customers SET total_spent_satang = GREATEST(0, total_spent_satang - $1), updated_at=now()
           WHERE tenant_id=$2 AND id=$3`,
          [sale.total_satang, tenantId, sale.customer_id],
        );
        const points = Math.floor(Number(sale.total_satang) / 10_000) * ctx.business!.loyaltyEarnPerBaht;
        if (points > 0) {
          await client.query(
            `INSERT INTO loyalty_ledger (tenant_id, customer_id, sale_id, points_delta, type, reason)
             VALUES ($1,$2,$3,$4,'adjust',$5)`,
            [tenantId, sale.customer_id, saleId, -points, `Void ${sale.number}`],
          );
        }
        if (Number(sale.points_redeemed) > 0) {
          await client.query(
            `INSERT INTO loyalty_ledger (tenant_id, customer_id, sale_id, points_delta, type, reason)
             VALUES ($1,$2,$3,$4,'adjust',$5)`,
            [tenantId, sale.customer_id, saleId, Number(sale.points_redeemed), `Points restored (void ${sale.number})`],
          );
        }
      }
      await writeAudit(client, {
        tenantId,
        storeId: store.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'sale.voided',
        entityType: 'sale',
        entityId: saleId,
        before: { number: sale.number, totalSatang: sale.total_satang },
        after: { status: 'voided', reason: input.reason },
        reason: input.reason,
        correlationId: ctx.correlationId,
      });

      return { saleId, number: sale.number, status: 'voided' as const, reversedSatang: Number(sale.total_satang) };
    },
  );
  return { ...result.data, replayed: result.replayed };
}
