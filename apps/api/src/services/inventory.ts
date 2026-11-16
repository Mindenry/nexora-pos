import type { DbClient } from '@nexora/db';
import { NexoraError, type MovementType } from '@nexora/shared';

export interface NewMovement {
  tenantId: string;
  storeId: string;
  variantId: string;
  type: MovementType;
  qtyDelta: number;
  unitCostSatang: number;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string;
  createdBy?: string | null;
  reversesId?: string | null;
}

export async function appendMovement(client: DbClient, movement: NewMovement): Promise<string> {
  if (!Number.isInteger(movement.qtyDelta) || movement.qtyDelta === 0) {
    throw new NexoraError('VALIDATION_QTY_INVALID');
  }
  const result = await client.query<{ id: string }>(
    `INSERT INTO inventory_movements
      (tenant_id, store_id, variant_id, type, qty_delta, unit_cost_satang,
       reference_type, reference_id, reason, created_by, reverses_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      movement.tenantId,
      movement.storeId,
      movement.variantId,
      movement.type,
      movement.qtyDelta,
      movement.unitCostSatang,
      movement.referenceType ?? null,
      movement.referenceId ?? null,
      movement.reason ?? '',
      movement.createdBy ?? null,
      movement.reversesId ?? null,
    ],
  );
  return result.rows[0]!.id;
}

export async function onHandMap(
  client: DbClient,
  tenantId: string,
  storeId: string,
  variantIds: string[],
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const result = await client.query<{ variant_id: string; on_hand: number }>(
    `SELECT variant_id, on_hand FROM v_stock_on_hand
     WHERE tenant_id = $1 AND store_id = $2 AND variant_id = ANY($3::uuid[])`,
    [tenantId, storeId, variantIds],
  );
  return new Map(result.rows.map((r) => [r.variant_id, Number(r.on_hand)]));
}

export async function onHandForVariant(
  client: DbClient,
  tenantId: string,
  storeId: string,
  variantId: string,
): Promise<number> {
  const result = await client.query<{ on_hand: number }>(
    `SELECT COALESCE(sum(qty_delta), 0)::bigint AS on_hand
     FROM inventory_movements
     WHERE tenant_id = $1 AND store_id = $2 AND variant_id = $3`,
    [tenantId, storeId, variantId],
  );
  return Number(result.rows[0]?.on_hand ?? 0);
}
