import type { DbClient } from '@nexora/db';

export async function allocateDocumentNumber(
  client: DbClient,
  params: {
    tenantId: string;
    storeId: string;
    docType: 'sale' | 'refund' | 'transfer' | 'purchase' | 'receipt' | 'goods_receipt';
    period: string;
    prefix: string;
  },
): Promise<string> {
  const result = await client.query<{ next_number: number }>(
    'SELECT next_document_number($1,$2,$3,$4) AS next_number',
    [params.tenantId, params.storeId, params.docType, params.period],
  );
  const sequence = Number(result.rows[0]?.next_number ?? 1);
  return `${params.prefix}-${params.period.replace(/-/g, '')}-${String(sequence).padStart(5, '0')}`;
}
