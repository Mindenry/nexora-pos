import type { DbClient } from '@nexora/db';
import {
  NexoraError,
  quoteCart,
  type CheckoutInput,
} from '@nexora/shared';
import type { RequestContext } from '../types';
import { onHandMap } from './inventory';
import { loadActivePromotions } from './promotions';

export interface VariantRow {
  id: string;
  variant_name: string;
  sku: string | null;
  barcode: string | null;
  price_satang: number;
  cost_satang: number;
  status: string;
  product_id: string;
  product_name: string;
  category_id: string | null;
  tax_rate_bp: number | null;
  track_inventory: boolean;
  product_status: string;
  reorder_point: number;
}

export interface PricedPosCart {
  quote: ReturnType<typeof quoteCart>;
  customer: { id: string; name: string; phone: string | null; tier: string; points: number } | null;
  variants: Map<string, VariantRow>;
  stockBefore: Map<string, number>;
  warnings: string[];
  pointsRedeemed: number;
  pointsDiscountSatang: number;
}

type PriceInput = Pick<
  CheckoutInput,
  'items' | 'orderDiscount' | 'couponCode' | 'customerId' | 'redeemPoints' | 'offline'
>;

/**
 * Authoritative cart pricing shared by checkout and PromptPay session
 * creation. The client never supplies a trusted total: both paths load prices,
 * promotions, loyalty and stock from the database.
 */
export async function pricePosCart(
  client: DbClient,
  ctx: RequestContext,
  input: PriceInput,
): Promise<PricedPosCart> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;
  const business = ctx.business!;

  if (input.items.length === 0) throw new NexoraError('DOMAIN_CART_EMPTY');

  const variantIds = [...new Set(input.items.map((i) => i.variantId))];
  const variantsResult = await client.query<VariantRow>(
    `SELECT v.id, v.name AS variant_name, v.sku, v.barcode, v.price_satang, v.cost_satang, v.status,
            p.id AS product_id, p.name AS product_name, p.category_id, p.tax_rate_bp,
            p.track_inventory, p.status AS product_status, p.reorder_point
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.tenant_id = $1 AND v.id = ANY($2::uuid[])`,
    [tenantId, variantIds],
  );
  if (variantsResult.rowCount !== variantIds.length) {
    throw new NexoraError('NOT_FOUND', { entity: 'variant' });
  }
  const variants = new Map(variantsResult.rows.map((v) => [v.id, v]));
  for (const variant of variants.values()) {
    if (variant.status !== 'active' || variant.product_status !== 'active') {
      throw new NexoraError('VALIDATION_FAILED', {
        reason: 'product_inactive',
        variantId: variant.id,
      });
    }
  }

  const promotions = await loadActivePromotions(client, tenantId);

  let customer: PricedPosCart['customer'] = null;
  if (input.customerId) {
    const found = await client.query<{
      id: string;
      name: string;
      phone: string | null;
      tier: string;
      points: number;
    }>(
      `SELECT c.id, c.name, c.phone, c.tier,
              COALESCE((SELECT sum(points_delta) FROM loyalty_ledger l WHERE l.customer_id = c.id), 0)::bigint AS points
       FROM customers c WHERE c.tenant_id = $1 AND c.id = $2`,
      [tenantId, input.customerId],
    );
    if (!found.rows[0]) throw new NexoraError('NOT_FOUND', { entity: 'customer' });
    customer = { ...found.rows[0], points: Number(found.rows[0].points) };
  }

  const quoteInput = {
    lines: input.items.map((item, index) => {
      const variant = variants.get(item.variantId)!;
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
    couponCode: input.couponCode || null,
    promotions,
    taxRateBp: business.vatRateBp,
    pricesIncludeTax: business.pricesIncludeTax,
    memberDiscountBp: 0,
  };
  let quote = quoteCart(quoteInput);

  if (input.couponCode && quote.ignoredCouponReason) {
    throw new NexoraError('DOMAIN_COUPON_INVALID', { reason: quote.ignoredCouponReason });
  }

  const manualDiscount =
    quote.discountSatang - quote.appliedPromotions.reduce((sum, p) => sum + p.amountSatang, 0);
  const limitSatang = Math.floor((quote.subtotalSatang * business.discountLimitBp) / 10_000);
  if (manualDiscount > limitSatang && !ctx.permissions.has('sales.cancel')) {
    throw new NexoraError('AUTH_PERMISSION_DENIED', {
      reason: 'discount_limit',
      limitSatang,
    });
  }

  let pointsRedeemed = 0;
  let pointsDiscountSatang = 0;
  const requestedPoints = input.redeemPoints ?? 0;
  if (requestedPoints > 0) {
    if (!customer) {
      throw new NexoraError('VALIDATION_FAILED', {
        field: 'redeemPoints',
        reason: 'customer_required',
      });
    }
    if (!business.loyaltyRedemptionEnabled) throw new NexoraError('DOMAIN_LOYALTY_DISABLED');
    if (business.pointValueSatang <= 0) throw new NexoraError('DOMAIN_LOYALTY_DISABLED');
    if (customer.points < requestedPoints) {
      throw new NexoraError('DOMAIN_POINTS_INSUFFICIENT', {
        available: customer.points,
        requested: requestedPoints,
      });
    }
    pointsRedeemed = Math.min(
      requestedPoints,
      Math.floor(quote.totalSatang / business.pointValueSatang),
    );
    if (pointsRedeemed <= 0) {
      throw new NexoraError('DOMAIN_POINTS_INSUFFICIENT', { reason: 'nothing_to_redeem' });
    }
    pointsDiscountSatang = pointsRedeemed * business.pointValueSatang;
    quote = quoteCart({ ...quoteInput, extraDiscountSatang: pointsDiscountSatang });
  }

  const qtyByVariant = new Map<string, number>();
  for (const item of input.items) {
    qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.qty);
  }
  const stockBefore = await onHandMap(client, tenantId, store.id, [...qtyByVariant.keys()]);
  const warnings: string[] = [];
  if (!input.offline) {
    for (const [variantId, qty] of qtyByVariant) {
      const variant = variants.get(variantId)!;
      if (!variant.track_inventory) continue;
      const available = stockBefore.get(variantId) ?? 0;
      if (available < qty && !business.allowNegativeStock) {
        throw new NexoraError('DOMAIN_INSUFFICIENT_STOCK', {
          variantId,
          available,
          requested: qty,
        });
      }
      if (available < qty) warnings.push('NEGATIVE_STOCK');
    }
  }

  return {
    quote,
    customer,
    variants,
    stockBefore,
    warnings,
    pointsRedeemed,
    pointsDiscountSatang,
  };
}
