import type { DbClient } from '@nexora/db';
import type { QuotePromotion } from '@nexora/shared';

interface PromotionRow {
  id: string;
  name: string;
  code: string | null;
  kind: 'order_percent' | 'order_amount' | 'product_percent' | 'category_percent';
  value_bp: number | null;
  value_satang: number | null;
  target_ids: string[];
  min_subtotal_satang: number;
  stackable: boolean;
  priority: number;
  coupon_enabled: boolean;
}

export async function loadActivePromotions(
  client: DbClient,
  tenantId: string,
): Promise<QuotePromotion[]> {
  const result = await client.query<PromotionRow>(
    `SELECT id, name, code, kind, value_bp, value_satang, target_ids, min_subtotal_satang,
            stackable, priority, coupon_enabled
     FROM promotions
     WHERE tenant_id = $1
       AND is_active
       AND (starts_at IS NULL OR starts_at <= now())
       AND (ends_at IS NULL OR ends_at >= now())
       AND (usage_limit IS NULL OR used_count < usage_limit)
     ORDER BY priority DESC`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code ?? '',
    name: row.name,
    kind: row.kind,
    valueBp: row.value_bp,
    valueSatang: row.value_satang != null ? Number(row.value_satang) : null,
    targetIds: row.target_ids,
    minSubtotalSatang: Number(row.min_subtotal_satang),
    stackable: row.stackable,
    priority: row.priority,
    couponCode: row.coupon_enabled ? row.code : null,
  }));
}
