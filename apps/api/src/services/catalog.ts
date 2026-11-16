import type { DbClient } from '@nexora/db';

export interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export interface VariantJson {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceSatang: number;
  costSatang: number;
  isDefault: boolean;
  attributes: Record<string, string>;
  onHand?: number;
}

export interface ProductListRow {
  id: string;
  name: string;
  status: string;
  type: string;
  track_inventory: boolean;
  reorder_point: number;
  image_url: string;
  category_id: string | null;
  category_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  unit_id: string | null;
  unit_code: string | null;
  min_price: number | null;
  max_price: number | null;
  variants: VariantJson[] | null;
  on_hand: number;
  created_at: string;
  updated_at: string;
  total_count?: number;
}

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  status?: 'active' | 'draft' | 'archived';
  lowStock?: boolean;
  page: number;
  pageSize: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

const SORTABLE: Record<string, string> = {
  name: 'name',
  created_at: 'created_at',
  updated_at: 'updated_at',
  price: 'min_price',
  stock: 'on_hand',
};

export async function listProducts(
  client: DbClient,
  tenantId: string,
  storeId: string | null,
  filters: ProductFilters,
) {
  const sortColumn = SORTABLE[filters.sort ?? 'name'] ?? 'name';
  const direction = filters.order === 'desc' ? 'DESC' : 'ASC';
  const offset = (filters.page - 1) * filters.pageSize;
  const search = filters.search?.trim() || null;

  const result = await client.query<ProductListRow>(
    `WITH base AS (
       SELECT p.id, p.name, p.status, p.type, p.track_inventory, p.reorder_point, p.image_url,
              p.category_id, c.name AS category_name,
              p.brand_id, b.name AS brand_name,
              p.unit_id, u.code AS unit_code,
              p.created_at, p.updated_at,
              (SELECT min(v.price_satang) FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS min_price,
              (SELECT max(v.price_satang) FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS max_price,
              (SELECT jsonb_agg(jsonb_build_object(
                        'id', v.id, 'name', v.name, 'sku', v.sku, 'barcode', v.barcode,
                        'priceSatang', v.price_satang, 'costSatang', v.cost_satang,
                        'isDefault', v.is_default, 'attributes', v.attributes)
                        ORDER BY v.is_default DESC, v.name)
                 FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS variants,
              COALESCE((
                SELECT sum(m.qty_delta) FROM inventory_movements m
                JOIN product_variants v2 ON v2.id = m.variant_id
                WHERE m.tenant_id = p.tenant_id AND m.store_id = $2 AND v2.product_id = p.id
              ), 0)::bigint AS on_hand
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN units u ON u.id = p.unit_id
       WHERE p.tenant_id = $1
         AND ($3::text IS NULL OR p.status = $3)
         AND ($4::uuid IS NULL OR p.category_id = $4)
         AND (
           $5::text IS NULL
           OR p.name ILIKE '%' || $5 || '%'
           OR EXISTS (
             SELECT 1 FROM product_variants v3
             WHERE v3.product_id = p.id
               AND (v3.sku ILIKE '%' || $5 || '%' OR v3.barcode = $5)
           )
         )
     )
     SELECT *, count(*) OVER() AS total_count
     FROM base
     WHERE ($6::boolean IS NOT TRUE OR on_hand <= reorder_point)
     ORDER BY ${sortColumn} ${direction} NULLS LAST, id
     LIMIT $7 OFFSET $8`,
    [
      tenantId,
      storeId,
      filters.status ?? null,
      filters.categoryId ?? null,
      search,
      filters.lowStock ?? null,
      filters.pageSize,
      offset,
    ],
  );

  const total = Number(result.rows[0]?.total_count ?? 0);
  return { rows: result.rows, total };
}

export async function getProductDetail(
  client: DbClient,
  tenantId: string,
  storeId: string | null,
  productId: string,
) {
  const product = await client.query(
    `SELECT p.id, p.name, p.description, p.image_url, p.type, p.tax_rate_bp,
            p.track_inventory, p.reorder_point, p.status, p.category_id, p.brand_id, p.unit_id,
            c.name AS category_name, b.name AS brand_name, u.code AS unit_code,
            p.created_at, p.updated_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.tenant_id = $1 AND p.id = $2`,
    [tenantId, productId],
  );
  if (!product.rows[0]) return null;

  const variants = await client.query(
    `SELECT v.id, v.name, v.sku, v.barcode, v.price_satang, v.cost_satang, v.compare_at_satang,
            v.attributes, v.is_default, v.status,
            COALESCE((SELECT sum(m.qty_delta) FROM inventory_movements m
                      WHERE m.variant_id = v.id AND m.store_id = $3), 0)::bigint AS on_hand,
            (SELECT jsonb_agg(jsonb_build_object('id', pb.id, 'barcode', pb.barcode))
             FROM product_barcodes pb WHERE pb.variant_id = v.id) AS extra_barcodes
     FROM product_variants v
     WHERE v.tenant_id = $1 AND v.product_id = $2
     ORDER BY v.is_default DESC, v.name`,
    [tenantId, productId, storeId],
  );
  return { ...product.rows[0], variants: variants.rows };
}

export async function posCatalog(
  client: DbClient,
  tenantId: string,
  storeId: string,
) {
  const categories = await client.query<CategoryRow>(
    `SELECT id, name, parent_id, sort_order FROM categories WHERE tenant_id = $1 ORDER BY sort_order, name`,
    [tenantId],
  );

  const products = await client.query<{
    product_id: string;
    product_name: string;
    category_id: string | null;
    image_url: string;
    track_inventory: boolean;
    reorder_point: number;
    variant_id: string;
    variant_name: string;
    sku: string | null;
    barcode: string | null;
    price_satang: number;
    cost_satang: number;
    tax_rate_bp: number | null;
    attributes: Record<string, string>;
    on_hand: number;
  }>(
    `SELECT p.id AS product_id, p.name AS product_name, p.category_id, p.image_url,
            p.track_inventory, p.reorder_point,
            v.id AS variant_id, v.name AS variant_name, v.sku, v.barcode,
            v.price_satang, v.cost_satang, p.tax_rate_bp, v.attributes,
            COALESCE(s.on_hand, 0)::bigint AS on_hand
     FROM products p
     JOIN product_variants v ON v.product_id = p.id AND v.status = 'active'
     LEFT JOIN v_stock_on_hand s
       ON s.tenant_id = p.tenant_id AND s.store_id = $2 AND s.variant_id = v.id
     WHERE p.tenant_id = $1 AND p.status = 'active'
     ORDER BY p.name, v.is_default DESC, v.name`,
    [tenantId, storeId],
  );

  const grouped = new Map<
    string,
    {
      id: string;
      name: string;
      categoryId: string | null;
      imageUrl: string;
      trackInventory: boolean;
      reorderPoint: number;
      taxRateBp: number | null;
      variants: Array<Record<string, unknown>>;
      onHand: number;
    }
  >();

  for (const row of products.rows) {
    let product = grouped.get(row.product_id);
    if (!product) {
      product = {
        id: row.product_id,
        name: row.product_name,
        categoryId: row.category_id,
        imageUrl: row.image_url,
        trackInventory: row.track_inventory,
        reorderPoint: row.reorder_point,
        taxRateBp: row.tax_rate_bp,
        variants: [],
        onHand: 0,
      };
      grouped.set(row.product_id, product);
    }
    product.onHand += Number(row.on_hand);
    product.variants.push({
      id: row.variant_id,
      name: row.variant_name,
      sku: row.sku,
      barcode: row.barcode,
      priceSatang: row.price_satang,
      costSatang: row.cost_satang,
      attributes: row.attributes,
      onHand: Number(row.on_hand),
      trackInventory: row.track_inventory,
    });
  }

  return {
    categories: categories.rows.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id,
      sortOrder: c.sort_order,
    })),
    products: [...grouped.values()],
  };
}
