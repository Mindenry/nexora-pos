import type { DbClient } from '@nexora/db';
import {
  NexoraError,
  TIER_THRESHOLDS,
  businessDateOf,
  quoteCart,
  type CheckoutInput,
  type Discount,
} from '@nexora/shared';
import type { RequestContext } from '../types';
import { writeAudit } from './audit';
import { appendMovement, onHandMap } from './inventory';
import { runIdempotent } from './idempotency';
import { allocateDocumentNumber } from './numbering';
import { pricePosCart, type VariantRow } from './pos-pricing';
import { loadActivePromotions } from './promotions';

interface PaymentMethodRow {
  code: string;
  name: string;
  type: 'cash' | 'card' | 'qr' | 'transfer' | 'other';
  requires_reference: boolean;
  opens_drawer: boolean;
}

export interface CheckoutResult {
  saleId: string;
  number: string;
  status: string;
  businessDate: string;
  occurredAt: string;
  subtotalSatang: number;
  discountSatang: number;
  taxSatang: number;
  totalSatang: number;
  changeSatang: number;
  itemCount: number;
  loyaltyPoints: number;
  pointsRedeemed: number;
  pointsDiscountSatang: number;
  customerPointsBalance: number | null;
  customer: { id: string; name: string } | null;
  receipt: Record<string, unknown>;
  appliedPromotions: Array<{ id: string; code: string; name: string; amountSatang: number }>;
  ignoredCouponReason: string | null;
  warnings: string[];
  replayed?: boolean;
}

export async function performCheckout(
  client: DbClient,
  ctx: RequestContext,
  input: CheckoutInput,
  options: { allowHistorical?: boolean } = {},
): Promise<CheckoutResult> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;
  const employee = ctx.employee!;
  const business = ctx.business!;

  const result = await runIdempotent(
    client,
    {
      tenantId,
      operationId: input.operationId,
      scope: 'pos.checkout',
      payload: { input, storeId: store.id, employeeId: employee.id },
    },
    async () => {
      if (input.offline && !business.offlineCashEnabled) {
        throw new NexoraError('DOMAIN_OFFLINE_DISABLED');
      }

      const shift = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM shifts
         WHERE tenant_id = $1 AND store_id = $2 AND employee_id = $3 AND status = 'open'
         FOR UPDATE`,
        [tenantId, store.id, employee.id],
      );
      const shiftRow = shift.rows[0];
      if (!shiftRow) throw new NexoraError('DOMAIN_SHIFT_NOT_OPEN');

      const priced = await pricePosCart(client, ctx, input);
      const {
        quote,
        customer,
        variants,
        stockBefore,
        warnings,
        pointsRedeemed,
        pointsDiscountSatang,
      } = priced;
      const qtyByVariant = new Map<string, number>();
      for (const item of input.items) {
        qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.qty);
      }

      const methods = await client.query<PaymentMethodRow>(
        `SELECT code, name, type, requires_reference, opens_drawer FROM payment_methods
         WHERE tenant_id = $1 AND store_id = $2 AND is_active`,
        [tenantId, store.id],
      );
      const methodMap = new Map(methods.rows.map((m) => [m.code, m]));

      let appliedTotal = 0;
      let changeTotal = 0;
      const normalizedPayments: Array<{
        method: PaymentMethodRow;
        amountSatang: number;
        tenderedSatang: number;
        changeSatang: number;
        reference: string;
        promptpaySessionId: string | null;
      }> = [];

      const promptpaySessionIds = [
        ...new Set(
          input.payments
            .map((payment) => payment.promptpaySessionId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const promptpaySessions = new Map<
        string,
        {
          id: string;
          store_id: string;
          operation_id: string;
          sale_id: string | null;
          reference: string;
          amount_satang: number;
          status: string;
        }
      >();
      if (promptpaySessionIds.length > 0) {
        const sessions = await client.query<{
          id: string;
          store_id: string;
          operation_id: string;
          sale_id: string | null;
          reference: string;
          amount_satang: number;
          status: string;
        }>(
          `SELECT id, store_id, operation_id, sale_id, reference, amount_satang, status
           FROM payment_sessions
           WHERE tenant_id = $1 AND id = ANY($2::uuid[])
           FOR UPDATE`,
          [tenantId, promptpaySessionIds],
        );
        for (const row of sessions.rows) promptpaySessions.set(row.id, row);
      }

      for (const payment of input.payments) {
        const method = methodMap.get(payment.method);
        if (!method) throw new NexoraError('VALIDATION_FAILED', { field: 'payments.method' });
        if (input.offline && method.type !== 'cash') {
          throw new NexoraError('DOMAIN_OFFLINE_DISABLED', { reason: 'offline_non_cash' });
        }
        if (!ctx.permissions.has('payments.confirm') && method.type !== 'cash') {
          throw new NexoraError('AUTH_PERMISSION_DENIED', { reason: 'payments.confirm' });
        }
        const amount = Math.floor(payment.amountSatang);
        let reference = (payment.reference ?? '').trim();
        if (method.type !== 'cash' && !reference) {
          throw new NexoraError('VALIDATION_FAILED', { field: 'payments.reference', method: method.code });
        }

        let promptpaySessionId: string | null = payment.promptpaySessionId ?? null;
        if (method.code === 'promptpay') {
          if (!promptpaySessionId) {
            throw new NexoraError('DOMAIN_PROMPTPAY_NOT_PAID', { reason: 'session_required' });
          }
          const session = promptpaySessions.get(promptpaySessionId);
          if (!session) throw new NexoraError('DOMAIN_PROMPTPAY_NOT_PAID', { reason: 'session_missing' });
          if (session.store_id !== store.id) throw new NexoraError('AUTH_STORE_FORBIDDEN');
          if (session.sale_id) {
            throw new NexoraError('DOMAIN_PROMPTPAY_ALREADY_LINKED');
          }
          if (session.operation_id !== input.operationId) {
            throw new NexoraError('DOMAIN_PROMPTPAY_SESSION_STATE', { reason: 'operation_mismatch' });
          }
          if (session.status !== 'paid') {
            throw new NexoraError('DOMAIN_PROMPTPAY_NOT_PAID', { status: session.status });
          }
          if (Number(session.amount_satang) !== amount) {
            throw new NexoraError('DOMAIN_PROMPTPAY_AMOUNT_MISMATCH', {
              expected: Number(session.amount_satang),
              received: amount,
            });
          }
          if (!reference) reference = session.reference;
        } else if (promptpaySessionId) {
          throw new NexoraError('VALIDATION_FAILED', {
            field: 'payments.promptpaySessionId',
            reason: 'not_promptpay_method',
          });
        } else {
          promptpaySessionId = null;
        }

        if (method.type === 'cash') {
          const tendered = payment.tenderedSatang ?? amount;
          if (!Number.isInteger(tendered) || tendered < amount) {
            throw new NexoraError('DOMAIN_PAYMENT_MISMATCH', { reason: 'cash_tendered' });
          }
          normalizedPayments.push({
            method,
            amountSatang: amount,
            tenderedSatang: tendered,
            changeSatang: tendered - amount,
            reference: '',
            promptpaySessionId: null,
          });
          changeTotal += tendered - amount;
        } else {
          normalizedPayments.push({
            method,
            amountSatang: amount,
            tenderedSatang: amount,
            changeSatang: 0,
            reference,
            promptpaySessionId,
          });
        }
        appliedTotal += amount;
      }

      if (appliedTotal !== quote.totalSatang) {
        throw new NexoraError('DOMAIN_PAYMENT_MISMATCH', {
          expected: quote.totalSatang,
          received: appliedTotal,
        });
      }

      const now = new Date();
      let occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
      if (Number.isNaN(occurredAt.getTime())) occurredAt = now;
      if (!options.allowHistorical && Math.abs(now.getTime() - occurredAt.getTime()) > 48 * 60 * 60 * 1000) {
        occurredAt = now;
        warnings.push('DEVICE_CLOCK_CLAMPED');
      }
      const businessDate = businessDateOf(occurredAt, store.timezone);

      const number = await allocateDocumentNumber(client, {
        tenantId,
        storeId: store.id,
        docType: 'sale',
        period: businessDate,
        prefix: store.receiptPrefix || business.receiptPrefix || 'R',
      });

      const receiptSnapshotBase = {
        type: 'sale',
        number,
        businessDate,
        issuedAt: now.toISOString(),
        occurredAt: occurredAt.toISOString(),
        business: {
          name: business.name,
          legalName: business.legalName,
          taxId: business.taxId,
          address: business.address,
          phone: business.phone,
        },
        store: { name: store.name, code: store.code, address: store.address, phone: store.phone, taxId: store.taxId },
        cashier: employee.displayName,
        customer: customer ? { name: customer.name, phone: customer.phone } : null,
        items: quote.lines.map((line) => ({
          name: line.name,
          sku: line.sku,
          qty: line.qty,
          unitPriceSatang: line.unitPriceSatang,
          discountSatang: line.discountSatang,
          taxSatang: line.taxSatang,
          totalSatang: line.totalSatang,
        })),
        subtotalSatang: quote.subtotalSatang,
        discountSatang: quote.discountSatang,
        taxSatang: quote.taxSatang,
        totalSatang: quote.totalSatang,
        changeSatang: changeTotal,
        vatRateBp: business.vatRateBp,
        pricesIncludeTax: business.pricesIncludeTax,
        pointsRedeemed,
        pointsDiscountSatang,
        payments: normalizedPayments.map((p) => ({
          method: p.method.code,
          methodName: p.method.name,
          amountSatang: p.amountSatang,
          reference: p.reference,
        })),
        appliedPromotions: quote.appliedPromotions,
        footer: business.receiptFooter,
        reprint: false,
      };

      const sale = await client.query<{ id: string; occurred_at: string }>(
        `INSERT INTO sales
          (tenant_id, store_id, shift_id, employee_id, customer_id, number, status,
           subtotal_satang, discount_satang, tax_satang, total_satang, cost_satang,
           change_satang, item_count, business_date, occurred_at, note, receipt_snapshot,
           operation_id, device_id, source, points_redeemed, points_discount_satang)
         VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22)
         RETURNING id, occurred_at`,
        [
          tenantId,
          store.id,
          shiftRow.id,
          employee.id,
          customer?.id ?? null,
          number,
          quote.subtotalSatang,
          quote.discountSatang,
          quote.taxSatang,
          quote.totalSatang,
          quote.costSatang,
          changeTotal,
          quote.itemCount,
          businessDate,
          occurredAt.toISOString(),
          input.note || '',
          JSON.stringify(receiptSnapshotBase),
          input.operationId,
          input.deviceId ?? null,
          input.offline ? 'offline' : 'online',
          pointsRedeemed,
          pointsDiscountSatang,
        ],
      );
      const saleId = sale.rows[0]!.id;

      const saleItemIds: string[] = [];
      for (const line of quote.lines) {
        const variant = variants.get(line.variantId)!;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO sale_items
            (tenant_id, sale_id, variant_id, product_name, variant_name, sku, qty,
             unit_price_satang, unit_cost_satang, discount_satang, tax_rate_bp, tax_satang,
             line_total_satang, cost_satang)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id`,
          [
            tenantId,
            saleId,
            line.variantId,
            variant.product_name,
            variant.variant_name,
            variant.sku ?? '',
            line.qty,
            line.unitPriceSatang,
            line.unitCostSatang,
            line.discountSatang,
            business.vatRateBp,
            line.taxSatang,
            line.totalSatang,
            line.costSatang,
          ],
        );
        saleItemIds.push(inserted.rows[0]!.id);
        if (variant.track_inventory) {
          await appendMovement(client, {
            tenantId,
            storeId: store.id,
            variantId: line.variantId,
            type: 'sales_deduction',
            qtyDelta: -line.qty,
            unitCostSatang: line.unitCostSatang,
            referenceType: 'sale',
            referenceId: saleId,
            reason: input.offline ? 'Offline sale synced' : '',
            createdBy: ctx.user.id,
          });
        }
      }

      const paymentIds: string[] = [];
      for (const payment of normalizedPayments) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO payments
            (tenant_id, sale_id, method, method_name, status, amount_satang, tendered_satang,
             change_satang, reference, provider, confirmed_by, confirmed_at, paid_at,
             promptpay_session_id)
           VALUES ($1,$2,$3,$4,'paid',$5,$6,$7,$8,'manual',$9,now(),now(),$10)
           RETURNING id`,
          [
            tenantId,
            saleId,
            payment.method.code,
            payment.method.name,
            payment.amountSatang,
            payment.tenderedSatang,
            payment.changeSatang,
            payment.reference,
            ctx.user.id,
            payment.promptpaySessionId,
          ],
        );
        const paymentId = inserted.rows[0]!.id;
        paymentIds.push(paymentId);
        if (payment.promptpaySessionId) {
          const linked = await client.query(
            `UPDATE payment_sessions
             SET sale_id = $1
             WHERE tenant_id = $2 AND id = $3 AND sale_id IS NULL`,
            [saleId, tenantId, payment.promptpaySessionId],
          );
          if (linked.rowCount !== 1) throw new NexoraError('DOMAIN_PROMPTPAY_ALREADY_LINKED');
          await client.query(
            `UPDATE payment_transactions SET sale_id = $1
             WHERE tenant_id = $2 AND payment_session_id = $3`,
            [saleId, tenantId, payment.promptpaySessionId],
          );
          await client.query(
            `INSERT INTO payment_audit_logs (tenant_id, payment_session_id, action, actor_id, metadata)
             VALUES ($1,$2,'sale_linked',$3,$4::jsonb)`,
            [
              tenantId,
              payment.promptpaySessionId,
              ctx.user.id,
              JSON.stringify({ saleId, saleNumber: number, amountSatang: payment.amountSatang }),
            ],
          );
        }
        await client.query(
          `INSERT INTO payment_events (tenant_id, payment_id, event, payload, actor_id)
           VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [
            tenantId,
            paymentId,
            payment.method.type === 'cash' ? 'cash_received' : 'manual_confirmed',
            JSON.stringify({ reference: payment.reference, amountSatang: payment.amountSatang }),
            ctx.user.id,
          ],
        );
        if (payment.method.type === 'cash' && payment.amountSatang > 0) {
          await client.query(
            `INSERT INTO cash_movements
              (tenant_id, store_id, shift_id, employee_id, type, amount_satang, reason, reference_type, reference_id)
             VALUES ($1,$2,$3,$4,'sale_cash',$5,'Sale cash','sale',$6)`,
            [tenantId, store.id, shiftRow.id, employee.id, payment.amountSatang, saleId],
          );
        }
      }

      let loyaltyPoints = 0;
      if (customer) {
        loyaltyPoints = Math.floor(quote.totalSatang / 10_000) * business.loyaltyEarnPerBaht;
        const newTotal = await client.query<{ total_spent_satang: number }>(
          `UPDATE customers SET total_spent_satang = total_spent_satang + $1,
             last_purchase_at = $2, updated_at = now()
           WHERE tenant_id=$3 AND id=$4
           RETURNING total_spent_satang`,
          [quote.totalSatang, occurredAt.toISOString(), tenantId, customer.id],
        );
        const spent = Number(newTotal.rows[0]?.total_spent_satang ?? 0);
        const tier =
          spent >= TIER_THRESHOLDS.platinum!
            ? 'platinum'
            : spent >= TIER_THRESHOLDS.gold!
              ? 'gold'
              : spent >= TIER_THRESHOLDS.silver!
                ? 'silver'
                : 'standard';
        await client.query('UPDATE customers SET tier = $1 WHERE tenant_id=$2 AND id=$3', [
          tier,
          tenantId,
          customer.id,
        ]);
        if (loyaltyPoints > 0) {
          await client.query(
            `INSERT INTO loyalty_ledger (tenant_id, customer_id, sale_id, points_delta, type, reason)
             VALUES ($1,$2,$3,$4,'earn','Purchase reward')`,
            [tenantId, customer.id, saleId, loyaltyPoints],
          );
          await client.query('UPDATE sales SET loyalty_points=$1 WHERE id=$2', [loyaltyPoints, saleId]);
        }
        if (pointsRedeemed > 0) {
          await client.query(
            `INSERT INTO loyalty_ledger (tenant_id, customer_id, sale_id, points_delta, type, reason)
             VALUES ($1,$2,$3,$4,'redeem','Redeemed at checkout')`,
            [tenantId, customer.id, saleId, -pointsRedeemed],
          );
        }
      }

      for (const promo of quote.appliedPromotions) {
        await client.query(
          'UPDATE promotions SET used_count = used_count + 1 WHERE tenant_id=$1 AND id=$2',
          [tenantId, promo.id],
        );
        await client.query(
          `INSERT INTO promotion_redemptions (tenant_id, promotion_id, sale_id, amount_satang)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, promo.id, saleId, promo.amountSatang],
        );
      }

      // Low-stock crossings only, to avoid a notification on every sale.
      for (const [variantId, qty] of qtyByVariant) {
        const variant = variants.get(variantId)!;
        if (!variant.track_inventory) continue;
        const before = stockBefore.get(variantId) ?? 0;
        const after = before - qty;
        if (before > variant.reorder_point && after <= variant.reorder_point) {
          await client.query(
            `INSERT INTO notifications (tenant_id, store_id, type, severity, title, body, link)
             VALUES ($1,$2,'low_stock','warning',$3,$4,'/inventory')`,
            [
              tenantId,
              store.id,
              `สต๊อกต่ำ: ${variant.product_name}`,
              `เหลือ ${after} ${variant.sku ? `(${variant.sku})` : ''} — จุดสั่งซื้อ ${variant.reorder_point}`,
            ],
          );
        }
      }

      const receiptSnapshot = {
        ...receiptSnapshotBase,
        saleId,
        items: quote.lines.map((line, i) => ({
          name: line.name,
          sku: line.sku,
          qty: line.qty,
          unitPriceSatang: line.unitPriceSatang,
          discountSatang: line.discountSatang,
          taxSatang: line.taxSatang,
          totalSatang: line.totalSatang,
          saleItemId: saleItemIds[i],
        })),
        paymentIds,
      };

      await client.query(
        'UPDATE sales SET receipt_snapshot = $1::jsonb WHERE tenant_id=$2 AND id=$3',
        [JSON.stringify(receiptSnapshot), tenantId, saleId],
      );
      await client.query(
        `INSERT INTO receipts (tenant_id, sale_id, number, type, snapshot, printed_count, created_by)
         VALUES ($1,$2,$3,'sale',$4::jsonb,0,$5)`,
        [tenantId, saleId, number, JSON.stringify(receiptSnapshot), ctx.user.id],
      );

      await writeAudit(client, {
        tenantId,
        storeId: store.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'sale.completed',
        entityType: 'sale',
        entityId: saleId,
        after: {
          number,
          totalSatang: quote.totalSatang,
          discountSatang: quote.discountSatang,
          taxSatang: quote.taxSatang,
          paymentMethods: normalizedPayments.map((p) => p.method.code),
          source: input.offline ? 'offline' : 'online',
          pointsRedeemed,
          pointsDiscountSatang,
        },
        correlationId: ctx.correlationId,
      });

      return {
        saleId,
        number,
        status: 'completed',
        businessDate,
        occurredAt: sale.rows[0]!.occurred_at,
        subtotalSatang: quote.subtotalSatang,
        discountSatang: quote.discountSatang,
        taxSatang: quote.taxSatang,
        totalSatang: quote.totalSatang,
        changeSatang: changeTotal,
        itemCount: quote.itemCount,
        loyaltyPoints,
        pointsRedeemed,
        pointsDiscountSatang,
        customerPointsBalance: customer ? customer.points - pointsRedeemed + loyaltyPoints : null,
        customer: customer ? { id: customer.id, name: customer.name } : null,
        receipt: receiptSnapshot,
        appliedPromotions: quote.appliedPromotions,
        ignoredCouponReason: quote.ignoredCouponReason,
        warnings,
      };
    },
  );

  return { ...result.data, replayed: result.replayed };
}

/** Preview used by the POS (same pricing code as checkout). */
export async function quoteForPos(
  client: DbClient,
  ctx: RequestContext,
  input: {
    items: Array<{ variantId: string; qty: number; lineDiscount?: Discount | null }>;
    orderDiscount?: Discount | null;
    couponCode?: string | null;
    customerId?: string | null;
    memberDiscountBp?: number;
  },
) {
  const tenantId = ctx.tenant!.id;
  const business = ctx.business!;
  const ids = [...new Set(input.items.map((i) => i.variantId))];
  const variants = await client.query<VariantRow>(
    `SELECT v.id, v.name AS variant_name, v.sku, v.barcode, v.price_satang, v.cost_satang, v.status,
            p.id AS product_id, p.name AS product_name, p.category_id, p.tax_rate_bp,
            p.track_inventory, p.status AS product_status, p.reorder_point
     FROM product_variants v JOIN products p ON p.id=v.product_id
     WHERE v.tenant_id=$1 AND v.id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  const map = new Map(variants.rows.map((v) => [v.id, v]));
  if (map.size !== ids.length) throw new NexoraError('NOT_FOUND', { entity: 'variant' });
  const promotions = await loadActivePromotions(client, tenantId);
  const quote = quoteCart({
    lines: input.items.map((item, index) => {
      const variant = map.get(item.variantId)!;
      return {
        key: String(index),
        variantId: variant.id,
        productId: variant.product_id,
        categoryId: variant.category_id,
        name: `${variant.product_name}${variant.variant_name && variant.variant_name !== 'มาตรฐาน' ? ` · ${variant.variant_name}` : ''}`,
        sku: variant.sku ?? '',
        qty: item.qty,
        unitPriceSatang: Number(variant.price_satang),
        unitCostSatang: Number(variant.cost_satang),
        lineDiscount: item.lineDiscount ?? null,
      };
    }),
    orderDiscount: input.orderDiscount ?? null,
    couponCode: input.couponCode ?? null,
    promotions,
    taxRateBp: business.vatRateBp,
    pricesIncludeTax: business.pricesIncludeTax,
    memberDiscountBp: input.memberDiscountBp ?? 0,
  });
  const stock = await onHandMap(client, tenantId, ctx.store!.id, ids);
  return {
    ...quote,
    lines: quote.lines.map((line) => ({
      ...line,
      onHand: stock.get(line.variantId) ?? 0,
    })),
  };
}
