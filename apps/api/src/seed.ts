/**
 * Demo seed. Every sale is created through the real checkout service, so the
 * ledger, VAT, drawer and receipt numbers obey the same rules as production.
 * Demo data is marked with tenants.is_demo = true and uses fictional PII only.
 */
import { randomUUID } from 'node:crypto';
import { createDb } from '@nexora/db';
import {
  ALL_TENANT_PERMISSIONS,
  ROLE_DEFINITIONS,
  addDays,
  businessDateOf,
} from '@nexora/shared';
import { loadConfig } from './config';
import type { BusinessContext, EmployeeContext, RequestContext, StoreContext, TenantContext } from './types';
import { hashPassword } from './services/password';
import { openShift, shiftSummary } from './services/shifts';
import { performCheckout, quoteForPos } from './services/checkout';
import { performRefund } from './services/refunds';

const DEMO_PASSWORD = 'NexoraDemo!2026';
const ADMIN_PASSWORD = 'NexoraAdmin!2026';
const DEMO_EMAILS = {
  owner: 'owner@demo.nexora.local',
  manager: 'manager@demo.nexora.local',
  cashier1: 'cashier1@demo.nexora.local',
  cashier2: 'cashier2@demo.nexora.local',
  inventory: 'inventory@demo.nexora.local',
  accountant: 'accountant@demo.nexora.local',
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261116);
const pick = <T,>(arr: T[]): T => arr[Math.floor(random() * arr.length)]!;

const CATALOG: Array<{
  category: string;
  items: Array<{ name: string; price: number; cost: number; variants?: string[] }>;
}> = [
  {
    category: 'กาแฟ',
    items: [
      { name: 'อเมริกาโน่ เย็น', price: 65, cost: 22 },
      { name: 'ลาเต้ ร้อน', price: 75, cost: 28 },
      { name: 'คาปูชิโน่', price: 75, cost: 27 },
      { name: 'มอคค่า', price: 85, cost: 32 },
      { name: 'โคลด์บริว', price: 90, cost: 34 },
    ],
  },
  {
    category: 'เครื่องดื่ม',
    items: [
      { name: 'น้ำแร่ธรรมชาติ 600ml', price: 20, cost: 9 },
      { name: 'ชาเขียวมัทฉะ', price: 45, cost: 18 },
      { name: 'น้ำส้มคั้น 100%', price: 55, cost: 25 },
      { name: 'โซดามะนาว', price: 35, cost: 14 },
      { name: 'กาแฟกระป๋อง', price: 30, cost: 18 },
    ],
  },
  {
    category: 'ขนม',
    items: [
      { name: 'คุกกี้ช็อกโกแลตชิพ', price: 45, cost: 18 },
      { name: 'มัฟฟินบลูเบอร์รี่', price: 55, cost: 22 },
      { name: 'เค้กกล้วยหอม', price: 65, cost: 26 },
      { name: 'วาฟเฟิลเนยสด', price: 50, cost: 20 },
      { name: 'ดาร์กช็อกโกแลต 70%', price: 120, cost: 62 },
    ],
  },
  {
    category: 'อาหารแห้ง',
    items: [
      { name: 'ข้าวหอมมะลิ 5kg', price: 265, cost: 210 },
      { name: 'บะหมี่กึ่งสำเร็จรูป (แพ็ค 6)', price: 72, cost: 54 },
      { name: 'ข้าวโอ๊ต 500g', price: 95, cost: 62 },
      { name: 'ธัญพืชรวม 400g', price: 135, cost: 88 },
      { name: 'ถั่วรวมอบเกลือ 250g', price: 89, cost: 55 },
    ],
  },
  {
    category: 'เครื่องปรุง',
    items: [
      { name: 'น้ำปลาตราดี 700ml', price: 78, cost: 52 },
      { name: 'ซอสหอยนางรม 600ml', price: 68, cost: 45 },
      { name: 'น้ำตาลทราย 1kg', price: 32, cost: 24 },
      { name: 'พริกไทยป่น 50g', price: 45, cost: 28 },
      { name: 'น้ำมันพืช 1L', price: 68, cost: 52 },
    ],
  },
  {
    category: 'ของใช้ในบ้าน',
    items: [
      { name: 'ทิชชู่ม้วน (แพ็ค 6)', price: 135, cost: 92 },
      { name: 'สบู่เหลว 500ml', price: 89, cost: 55 },
      { name: 'น้ำยาล้างจาน 800ml', price: 65, cost: 42 },
      { name: 'ถุงขยะ 30L (ม้วน)', price: 45, cost: 28 },
      { name: 'ไม้กวาดทางมะพร้าว', price: 120, cost: 75 },
    ],
  },
  {
    category: 'เครื่องสำอาง',
    items: [
      { name: 'ครีมบำรุงผิว 50ml', price: 390, cost: 240 },
      { name: 'ลิปบาล์ม', price: 120, cost: 62 },
      { name: 'แชมพูสมุนไพร 400ml', price: 185, cost: 112 },
      { name: 'โลชั่นทาผิว 250ml', price: 220, cost: 135 },
      { name: 'เจลล้างหน้า 100ml', price: 165, cost: 98 },
    ],
  },
  {
    category: 'อิเล็กทรอนิกส์',
    items: [
      { name: 'หูฟัง Bluetooth', price: 890, cost: 540, variants: ['ดำ', 'ขาว', 'น้ำเงิน'] },
      { name: 'สายชาร์จ Type-C 1m', price: 250, cost: 95, variants: ['ขาว', 'ดำ'] },
      { name: 'พาวเวอร์แบงก์ 10,000mAh', price: 690, cost: 420, variants: ['ดำ', 'เทา'] },
      { name: 'เมาส์ไร้สาย', price: 490, cost: 280, variants: ['ดำ', 'ขาว'] },
      { name: 'ลำโพงพกพา', price: 1_290, cost: 780, variants: ['ดำ', 'แดง'] },
    ],
  },
  {
    category: 'เสื้อผ้า',
    items: [
      { name: 'เสื้อยืด Basic', price: 290, cost: 120, variants: ['S', 'M', 'L', 'XL'] },
      { name: 'กางเกงคาร์โก้', price: 690, cost: 320, variants: ['S', 'M', 'L'] },
      { name: 'หมวกแก๊ป', price: 250, cost: 110, variants: ['ดำ', 'ครีม'] },
      { name: 'ถุงเท้าคอตตอน (3 คู่)', price: 199, cost: 85, variants: ['ขาว', 'ดำ'] },
      { name: 'เสื้อเชิ้ตแขนยาว', price: 790, cost: 380, variants: ['S', 'M', 'L'] },
    ],
  },
  {
    category: 'เครื่องเขียน',
    items: [
      { name: 'ปากกาลูกลื่น (แพ็ค 5)', price: 55, cost: 28 },
      { name: 'สมุดโน้ต A5', price: 65, cost: 32 },
      { name: 'ดินสอ HB (แพ็ค 12)', price: 85, cost: 48 },
      { name: 'ไม้บรรทัด 30cm', price: 25, cost: 12 },
      { name: 'ลิควิดแก้คำผิด', price: 35, cost: 16 },
    ],
  },
  {
    category: 'สุขภาพ',
    items: [
      { name: 'หน้ากากอนามัย (กล่อง 50)', price: 149, cost: 85 },
      { name: 'เจลแอลกอฮอล์ 500ml', price: 129, cost: 72 },
      { name: 'วิตามินซี 1000mg', price: 320, cost: 190 },
      { name: 'ยาแก้ปวดหัว (แผง)', price: 35, cost: 18 },
      { name: 'พลาสเตอร์กันน้ำ', price: 45, cost: 22 },
    ],
  },
  {
    category: 'สัตว์เลี้ยง',
    items: [
      { name: 'อาหารแมว 1kg', price: 320, cost: 210 },
      { name: 'อาหารสุนัข 1kg', price: 290, cost: 185 },
      { name: 'ทรายแมว 5L', price: 185, cost: 110 },
      { name: 'ขนมแมว', price: 65, cost: 35 },
      { name: 'ของเล่นแมว', price: 99, cost: 45 },
    ],
  },
];

const CATEGORY_CODES = ['COF', 'DRK', 'SNK', 'DRY', 'CON', 'HOM', 'COS', 'ELE', 'APP', 'STA', 'HLT', 'PET'];

const CUSTOMERS = [
  { name: 'คุณสมชาย ใจดี', phone: '080-000-0001', tier: 'gold' },
  { name: 'คุณสมหญิง รักงาน', phone: '080-000-0002', tier: 'silver' },
  { name: 'คุณอรุณี สุขใจ', phone: '080-000-0003', tier: 'standard' },
  { name: 'คุณธนวัฒน์ พูลผล', phone: '080-000-0004', tier: 'platinum' },
  { name: 'คุณกมลชนก ศรีสุข', phone: '080-000-0005', tier: 'standard' },
  { name: 'คุณปิยะ แสงทอง', phone: '080-000-0006', tier: 'silver' },
  { name: 'คุณนฤมล วงศ์ไทย', phone: '080-000-0007', tier: 'standard' },
  { name: 'คุณวีระชัย มั่นคง', phone: '080-000-0008', tier: 'standard' },
  { name: 'คุณศิริพร ดวงดี', phone: '080-000-0009', tier: 'gold' },
  { name: 'คุณภาณุพงศ์ ทรัพย์มี', phone: '080-000-0010', tier: 'standard' },
  { name: 'คุณพิมพ์ชนก แก้วใส', phone: '080-000-0011', tier: 'silver' },
  { name: 'คุณจักรพงษ์ เรืองศรี', phone: '080-000-0012', tier: 'standard' },
];

const SUPPLIERS = [
  { name: 'เน็กซอรา ซัพพลาย', code: 'SUP-001', contact: 'คุณวิชัย', phone: '02-000-0001' },
  { name: 'บ้านเฟรช ดิสทริบิวชั่น', code: 'SUP-002', contact: 'คุณอรทัย', phone: '02-000-0002' },
  { name: 'สยาม กู๊ดส์ เทรดดิ้ง', code: 'SUP-003', contact: 'คุณมานพ', phone: '02-000-0003' },
  { name: 'เอเวอรี่เดย์ แล็บ', code: 'SUP-004', contact: 'คุณจุฬาลักษณ์', phone: '02-000-0004' },
];

function storeRowToContext(row: any): StoreContext {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    taxId: row.tax_id,
    receiptPrefix: row.receipt_prefix,
    isActive: row.is_active,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl, { applicationName: 'nexora-seed' });
  const started = Date.now();

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const adminPasswordHash = await hashPassword(ADMIN_PASSWORD);

  console.log('seed: clearing previous demo data…');
  await db.transaction(async (client) => {
    await client.query(`SELECT set_config('app.allow_purge', 'on', true)`);
    await client.query(
      `DELETE FROM tenants WHERE slug LIKE 'nexora-demo%' OR name IN ('Nexora Demo','Nexora Demo Retail')`,
    );
    await client.query(`DELETE FROM users WHERE lower(email) = $1`, ['admin@nexora.local']);
  });

  const base = await db.transaction(async (client) => {
    const admin = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, password_hash, name, locale, is_platform_admin, status)
       VALUES (NULL,$1,$2,'Platform Admin','th',true,'active') RETURNING id`,
      ['admin@nexora.local', adminPasswordHash],
    );

    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, status, onboarded_at, is_demo)
       VALUES ('Nexora Demo Retail','nexora-demo','active', now(), true) RETURNING id`,
    );
    const tenantId = tenant.rows[0]!.id;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    const businessResult = await client.query(
      `INSERT INTO businesses
        (tenant_id, name, legal_name, tax_id, address, phone, email, currency, timezone,
         vat_rate_bp, prices_include_tax, receipt_prefix, receipt_footer,
         loyalty_earn_per_baht, offline_cash_enabled, discount_limit_bp)
       VALUES ($1,'Nexora Demo Retail','บริษัท เน็กซอรา เดโม จำกัด','0105560000000',
         '88 ถนนสาทร กรุงเทพมหานคร 10120','02-000-0000','hello@demo.nexora.local','THB','Asia/Bangkok',
         700,true,'R','ขอบคุณที่ใช้บริการ • สินค้าชำรุดเปลี่ยนได้ภายใน 7 วัน',1,true,2000)
       RETURNING *`,
      [tenantId],
    );
    const businessRow = businessResult.rows[0]!;

    const plan = await client.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE code='growth'`,
    );
    await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end)
       VALUES ($1,$2,'active', now() + interval '1 month')`,
      [tenantId, plan.rows[0]!.id],
    );

    let ownerRoleId = '';
    for (const role of ROLE_DEFINITIONS) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO roles (tenant_id, code, name_th, name_en, scope, is_system)
         VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
        [tenantId, role.code, role.nameTh, role.nameEn, role.scope],
      );
      if (role.code === 'owner') ownerRoleId = inserted.rows[0]!.id;
      if (role.permissions.length) {
        await client.query(
          `INSERT INTO role_permissions (tenant_id, role_id, permission_code)
           SELECT $1,$2,unnest($3::text[])`,
          [tenantId, inserted.rows[0]!.id, role.permissions],
        );
      }
    }
    const roles = await client.query<{ id: string; code: string }>(
      'SELECT id, code FROM roles WHERE tenant_id=$1',
      [tenantId],
    );
    const roleId = new Map(roles.rows.map((r) => [r.code, r.id]));

    const storesResult = await client.query(
      `INSERT INTO stores (tenant_id, business_id, code, name, address, phone, timezone, tax_id, receipt_prefix)
       VALUES
        ($1,$2,'NXR-01','สาขาสยาม','อาคารเน็กซอรา ชั้น 1 ถนนพระราม 1 กรุงเทพฯ','02-111-1111','Asia/Bangkok','0105560000000','R'),
        ($1,$2,'NXR-02','สาขาทองหล่อ','ซอยทองหล่อ 13 กรุงเทพฯ','02-222-2222','Asia/Bangkok','0105560000000','R')
       RETURNING *`,
      [tenantId, businessRow.id],
    );
    const stores = storesResult.rows;
    const store1 = stores[0]!;
    const store2 = stores[1]!;

    for (const store of stores) {
      await client.query(
        `INSERT INTO payment_methods (tenant_id, store_id, code, name, type, requires_reference, opens_drawer, sort_order)
         VALUES
           ($1,$2,'cash','เงินสด','cash',false,true,10),
           ($1,$2,'transfer','โอนเงิน','transfer',true,false,20),
           ($1,$2,'card','บัตรเครดิต/เดบิต','card',true,false,30),
           ($1,$2,'qr','พร้อมเพย์ / QR','qr',true,false,40)`,
        [tenantId, store.id],
      );
    }

    await client.query(
      `INSERT INTO units (tenant_id, code, name) VALUES
        ($1,'pcs','ชิ้น'),($1,'box','กล่อง'),($1,'pack','แพ็ค'),($1,'kg','กิโลกรัม')`,
      [tenantId],
    );
    const units = await client.query<{ id: string; code: string }>(
      'SELECT id, code FROM units WHERE tenant_id=$1',
      [tenantId],
    );
    const pcsUnitId = units.rows.find((u) => u.code === 'pcs')!.id;

    const brands = ['Nexora Select', 'Baan Fresh', 'Siam Goods', 'Everyday Lab'];
    const brandIds: string[] = [];
    for (const brand of brands) {
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO brands (tenant_id, name) VALUES ($1,$2) RETURNING id',
        [tenantId, brand],
      );
      brandIds.push(inserted.rows[0]!.id);
    }

    const categoryIds = new Map<string, string>();
    for (const [index, category] of CATALOG.entries()) {
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO categories (tenant_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id',
        [tenantId, category.category, index],
      );
      categoryIds.set(category.category, inserted.rows[0]!.id);
    }

    const staff: Array<{ key: string; userId: string; employeeId: string; name: string; email: string; storeIds: string[]; role: string }> = [];
    const staffSpec = [
      { key: 'owner', name: 'คุณณัฐพล เจ้าของ', email: DEMO_EMAILS.owner, role: 'owner', stores: [store1.id, store2.id] },
      { key: 'manager', name: 'คุณปรียา ผู้จัดการ', email: DEMO_EMAILS.manager, role: 'manager', stores: [store1.id, store2.id] },
      { key: 'cashier1', name: 'คุณมายด์ แคชเชียร์', email: DEMO_EMAILS.cashier1, role: 'cashier', stores: [store1.id] },
      { key: 'cashier2', name: 'คุณบีม แคชเชียร์', email: DEMO_EMAILS.cashier2, role: 'cashier', stores: [store2.id] },
      { key: 'inventory', name: 'คุณโต้ง คลังสินค้า', email: DEMO_EMAILS.inventory, role: 'inventory', stores: [store1.id, store2.id] },
      { key: 'accountant', name: 'คุณฝน นักบัญชี', email: DEMO_EMAILS.accountant, role: 'accountant', stores: [store1.id, store2.id] },
    ];

    for (const spec of staffSpec) {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, password_hash, name, locale)
         VALUES ($1,$2,$3,$4,'th') RETURNING id`,
        [tenantId, spec.email, passwordHash, spec.name],
      );
      const employee = await client.query<{ id: string }>(
        `INSERT INTO employees (tenant_id, user_id, employee_code, display_name, default_store_id, hired_at)
         VALUES ($1,$2,$3,$4,$5, CURRENT_DATE - 120) RETURNING id`,
        [tenantId, user.rows[0]!.id, spec.key.toUpperCase(), spec.name, spec.stores[0]],
      );
      await client.query('INSERT INTO employee_roles (tenant_id, employee_id, role_id) VALUES ($1,$2,$3)', [
        tenantId,
        employee.rows[0]!.id,
        roleId.get(spec.role)!,
      ]);
      for (const storeId of spec.stores) {
        await client.query('INSERT INTO employee_stores (tenant_id, employee_id, store_id) VALUES ($1,$2,$3)', [
          tenantId,
          employee.rows[0]!.id,
          storeId,
        ]);
      }
      staff.push({
        key: spec.key,
        userId: user.rows[0]!.id,
        employeeId: employee.rows[0]!.id,
        name: spec.name,
        email: spec.email,
        storeIds: spec.stores,
        role: spec.role,
      });
    }

    const variants: Array<{
      id: string;
      productId: string;
      productName: string;
      variantName: string;
      sku: string;
      price: number;
      cost: number;
      categoryName: string;
    }> = [];

    let counter = 0;
    for (const [catIndex, category] of CATALOG.entries()) {
      const categoryId = categoryIds.get(category.category)!;
      for (const [itemIndex, item] of category.items.entries()) {
        const skuBase = `${CATEGORY_CODES[catIndex]}-${String(itemIndex + 1).padStart(3, '0')}`;
        const priceSatang = item.price * 100;
        const costSatang = item.cost * 100;
        const product = await client.query<{ id: string }>(
          `INSERT INTO products (tenant_id, category_id, brand_id, unit_id, name, description, type,
             track_inventory, reorder_point, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,5,'active') RETURNING id`,
          [
            tenantId,
            categoryId,
            brandIds[catIndex % brandIds.length],
            pcsUnitId,
            item.name,
            `${item.name} — ตัวอย่างสินค้าสำหรับเดโม`,
            item.variants ? 'variable' : 'simple',
          ],
        );
        const variantNames = item.variants ?? ['มาตรฐาน'];
        for (const [vi, variantName] of variantNames.entries()) {
          counter += 1;
          const sku = item.variants ? `${skuBase}-${String(vi + 1).padStart(2, '0')}` : skuBase;
          const barcode = `885${String(counter).padStart(10, '0')}`;
          const variant = await client.query<{ id: string }>(
            `INSERT INTO product_variants
              (tenant_id, product_id, name, sku, barcode, price_satang, cost_satang, is_default, attributes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id`,
            [
              tenantId,
              product.rows[0]!.id,
              variantName,
              sku,
              barcode,
              priceSatang + vi * 1000,
              costSatang + vi * 400,
              vi === 0,
              JSON.stringify(item.variants ? { variant: variantName } : {}),
            ],
          );
          variants.push({
            id: variant.rows[0]!.id,
            productId: product.rows[0]!.id,
            productName: item.name,
            variantName,
            sku,
            price: priceSatang + vi * 1000,
            cost: costSatang + vi * 400,
            categoryName: category.category,
          });
        }
      }
    }

    const stockByStore = new Map<string, Map<string, number>>();
    for (const store of stores) {
      const map = new Map<string, number>();
      for (const [index, variant] of variants.entries()) {
        const low = index % 23 === 0;
        const qty = low ? 9 : 70 + Math.floor(random() * 80);
        await client.query(
          `INSERT INTO inventory_movements
            (tenant_id, store_id, variant_id, type, qty_delta, unit_cost_satang, reason, created_by)
           VALUES ($1,$2,$3,'initial_load',$4,$5,'Demo opening stock',$6)`,
          [tenantId, store.id, variant.id, qty, variant.cost, staff.find((s) => s.key === 'inventory')!.userId],
        );
        map.set(variant.id, qty);
      }
      stockByStore.set(store.id, map);
    }

    // Customers
    const customers: Array<{ id: string; name: string; tier: string }> = [];
    for (const [index, customer] of CUSTOMERS.entries()) {
      const code = `CUS-${String(index + 1).padStart(5, '0')}`;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO customers
          (tenant_id, code, name, phone, email, tier, consent_marketing, consent_at, address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          tenantId,
          code,
          customer.name,
          customer.phone,
          `customer${index + 1}@demo.nexora.local`,
          customer.tier,
          index % 3 !== 0,
          index % 3 !== 0 ? new Date().toISOString() : null,
          `กรุงเทพมหานคร (เดโม ${index + 1})`,
        ],
      );
      customers.push({ id: inserted.rows[0]!.id, name: customer.name, tier: customer.tier });
    }

    await client.query(
      `INSERT INTO document_sequences (tenant_id, store_id, doc_type, period, next_number)
       VALUES ($1,$2,'customer','',1000)
       ON CONFLICT (tenant_id, store_id, doc_type, period) DO UPDATE SET next_number=1000`,
      [tenantId, store1.id],
    );

    // Suppliers
    const suppliers: string[] = [];
    for (const supplier of SUPPLIERS) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO suppliers (tenant_id, code, name, contact_name, phone, email, tax_id, address)
         VALUES ($1,$2,$3,$4,$5,$6,'0105560000000',$7) RETURNING id`,
        [
          tenantId,
          supplier.code,
          supplier.name,
          supplier.contact,
          supplier.phone,
          `supplier${supplier.code.slice(-1)}@demo.nexora.local`,
          'กรุงเทพมหานคร',
        ],
      );
      suppliers.push(inserted.rows[0]!.id);
    }

    // Promotions
    const coffeeCategoryId = categoryIds.get('กาแฟ')!;
    await client.query(
      `INSERT INTO promotions
        (tenant_id, name, kind, value_bp, min_subtotal_satang, stackable, priority, is_active)
       VALUES
        ($1,'ลด 10% เมื่อซื้อครบ 1,000 บาท','order_percent',1000,100000,false,10,true),
        ($1,'กาแฟลด 5%','category_percent',500,0,true,20,true)`,
      [tenantId],
    );
    const coffeeCat = await client.query<{ id: string }>(
      'SELECT id FROM promotions WHERE tenant_id=$1 AND kind=$2',
      [tenantId, 'category_percent'],
    );
    await client.query('UPDATE promotions SET target_ids=$1::uuid[] WHERE id=$2', [
      [coffeeCategoryId],
      coffeeCat.rows[0]!.id,
    ]);
    await client.query(
      `INSERT INTO promotions
        (tenant_id, name, code, kind, value_satang, min_subtotal_satang, stackable, priority, is_active, coupon_enabled)
       VALUES ($1,'คูปองต้อนรับ 50 บาท','WELCOME50','order_amount',5000,50000,false,100,true,true)`,
      [tenantId],
    );

    // One held sale for the demo cashier.
    await client.query(
      `INSERT INTO held_sales (tenant_id, store_id, employee_id, label, cart, expires_at)
       VALUES ($1,$2,$3,'ลูกค้าขอไปหยิบของเพิ่ม',$4::jsonb, now() + interval '12 hours')`,
      [
        tenantId,
        store1.id,
        staff.find((s) => s.key === 'cashier1')!.employeeId,
        JSON.stringify({ note: 'Demo held cart — เปิดจาก POS', items: [] }),
      ],
    );

    return {
      tenantId,
      businessRow,
      stores,
      staff,
      variants,
      customers,
      suppliers,
      stockByStore,
      adminId: admin.rows[0]!.id,
      ownerRoleId,
    };
  });

  const tenantContext: TenantContext = {
    id: base.tenantId,
    name: 'Nexora Demo Retail',
    slug: 'nexora-demo',
    status: 'active',
    onboardedAt: new Date().toISOString(),
    isDemo: true,
    planCode: 'growth',
    subscriptionStatus: 'active',
    features: {
      pos: true,
      inventory: true,
      reports_basic: true,
      purchasing: true,
      loyalty: true,
      multi_store: true,
      offline: true,
    },
    maxStores: 5,
    maxEmployees: 30,
  };

  const business: BusinessContext = {
    id: base.businessRow.id,
    name: base.businessRow.name,
    legalName: base.businessRow.legal_name,
    taxId: base.businessRow.tax_id,
    address: base.businessRow.address,
    phone: base.businessRow.phone,
    email: base.businessRow.email,
    currency: base.businessRow.currency,
    timezone: base.businessRow.timezone,
    vatRateBp: base.businessRow.vat_rate_bp,
    pricesIncludeTax: base.businessRow.prices_include_tax,
    receiptPrefix: base.businessRow.receipt_prefix,
    receiptFooter: base.businessRow.receipt_footer,
    loyaltyEarnPerBaht: base.businessRow.loyalty_earn_per_baht,
    offlineCashEnabled: base.businessRow.offline_cash_enabled,
    discountLimitBp: base.businessRow.discount_limit_bp,
    allowNegativeStock: base.businessRow.allow_negative_stock,
  };

  const allPermissions = new Set<string>(ALL_TENANT_PERMISSIONS);
  const storeContexts = base.stores.map((s: any) => storeRowToContext(s));

  const makeCtx = (store: StoreContext, staffKey: string): RequestContext => {
    const person = base.staff.find((s) => s.key === staffKey)!;
    const employee: EmployeeContext = {
      id: person.employeeId,
      displayName: person.name,
      defaultStoreId: store.id,
      roleCodes: [person.role],
      tenantScope: true,
      storeIds: base.stores.map((s: any) => s.id),
    };
    return {
      correlationId: `seed-${randomUUID()}`,
      sessionId: 'seed-session',
      user: {
        id: person.userId,
        email: person.email,
        name: person.name,
        locale: 'th',
        isPlatformAdmin: false,
        tenantId: base.tenantId,
      },
      employee,
      tenant: tenantContext,
      business,
      store,
      stores: storeContexts,
      permissions: allPermissions,
      withDb: (fn) => db.withTenant(base.tenantId, fn),
      withPlatform: async () => {
        throw new Error('not available in seed');
      },
    };
  };

  console.log('seed: generating 30 days of sales through checkout service…');
  const today = businessDateOf(new Date(), 'Asia/Bangkok');
  let saleCount = 0;
  let refundCount = 0;

  for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
    const date = addDays(today, -dayOffset);
    for (const [storeIndex, store] of storeContexts.entries()) {
      const staffKey = storeIndex === 0 ? 'cashier1' : 'cashier2';
      const ctx = makeCtx(store, staffKey);
      const stock = base.stockByStore.get(store.id)!;

      const shift = await db.withTenant(base.tenantId, (client) =>
        openShift(client, {
          tenantId: base.tenantId,
          storeId: store.id,
          employeeId: ctx.employee!.id,
          userId: ctx.user.id,
          timezone: store.timezone,
          openingCashSatang: 200_000,
          terminalName: storeIndex === 0 ? 'Counter 1' : 'Counter 2',
        }),
      );
      await db.withTenant(base.tenantId, (client) =>
        client.query('UPDATE shifts SET opened_at=$1, business_date=$2 WHERE id=$3', [
          `${date}T09:00:00+07:00`,
          date,
          shift.id,
        ]),
      );

      const salesToday = 4 + Math.floor(random() * 4);
      for (let s = 0; s < salesToday; s += 1) {
        const lineCount = 1 + Math.floor(random() * 3);
        const chosen: Array<{ variant: (typeof base.variants)[number]; qty: number }> = [];
        for (let attempt = 0; attempt < 12 && chosen.length < lineCount; attempt += 1) {
          const variant = pick(base.variants);
          if (chosen.some((c) => c.variant.id === variant.id)) continue;
          const qty = random() < 0.72 ? 1 : 2;
          if ((stock.get(variant.id) ?? 0) < qty) continue;
          chosen.push({ variant, qty });
        }
        if (chosen.length === 0) continue;

        const customer = random() < 0.32 ? pick(base.customers) : null;
        const items = chosen.map((c) => ({ variantId: c.variant.id, qty: c.qty }));
        const quote = await db.withTenant(base.tenantId, (client) =>
          quoteForPos(client, ctx, { items, customerId: customer?.id ?? null }),
        );
        if (quote.totalSatang <= 0) continue;

        const hour = 10 + Math.floor(random() * 9);
        const minute = Math.floor(random() * 60);
        const occurredAt = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;
        const roll = random();
        const total = quote.totalSatang;
        let payments: Array<{
          method: string;
          amountSatang: number;
          tenderedSatang?: number;
          reference?: string;
        }>;
        if (roll < 0.65 || total < 10_000) {
          payments = [
            {
              method: 'cash',
              amountSatang: total,
              tenderedSatang: Math.ceil(total / 10_000) * 10_000 || total,
            },
          ];
        } else if (roll < 0.85) {
          const cardPart = 5_000;
          const cashPart = total - cardPart;
          payments = [
            {
              method: 'cash',
              amountSatang: cashPart,
              tenderedSatang: Math.ceil(cashPart / 10_000) * 10_000 || cashPart,
            },
            { method: 'card', amountSatang: cardPart, reference: `SEED-CARD-${saleCount + 1}` },
          ];
        } else if (roll < 0.95) {
          payments = [
            {
              method: 'transfer',
              amountSatang: total,
              reference: `SEED-TRF-${saleCount + 1}`,
            },
          ];
        } else {
          payments = [
            { method: 'qr', amountSatang: total, reference: `SEED-QR-${saleCount + 1}` },
          ];
        }

        const result = await db.withTenant(base.tenantId, (client) =>
          performCheckout(
            client,
            ctx,
            {
              operationId: randomUUID(),
              items,
              payments,
              customerId: customer?.id ?? null,
              occurredAt,
              deviceId: `seed-${store.code}`,
              offline: false,
            },
            { allowHistorical: true },
          ),
        );
        saleCount += 1;
        for (const line of quote.lines) {
          stock.set(line.variantId, (stock.get(line.variantId) ?? 0) - line.qty);
        }

        if (random() < 0.045) {
          const receiptItems = (result.receipt as any).items as Array<{ saleItemId: string; qty: number }>;
          const first = receiptItems?.[0];
          if (first) {
            const refundResult = await db.withTenant(base.tenantId, (client) =>
              performRefund(client, ctx, {
                operationId: randomUUID(),
                saleId: result.saleId,
                items: [{ saleItemId: first.saleItemId, qty: 1 }],
                reason: 'ลูกค้าเปลี่ยนใจ (เดโม)',
                restock: true,
              }),
            );
            refundCount += 1;
            await db.withTenant(base.tenantId, (client) =>
              client.query('UPDATE refunds SET business_date=$1 WHERE id=$2', [date, refundResult.refundId]),
            );
            stock.set(quote.lines[0]!.variantId, (stock.get(quote.lines[0]!.variantId) ?? 0) + 1);
          }
        }
      }

      const summary = await db.withTenant(base.tenantId, (client) =>
        shiftSummary(client, base.tenantId, shift.id),
      );
      await db.withTenant(base.tenantId, (client) =>
        client.query(
          `UPDATE shifts SET status='closed', closed_at=$1, expected_cash_satang=$2,
             counted_cash_satang=$2, variance_satang=0, business_date=$3
           WHERE id=$4`,
          [`${date}T20:30:00+07:00`, summary.expectedCashSatang, date, shift.id],
        ),
      );
    }
  }

  // Purchase orders: one draft, one submitted, one fully received.
  console.log('seed: creating purchase orders…');
  const poNumbers = ['PO-DEMO-001', 'PO-DEMO-002', 'PO-DEMO-003'];
  const poStatuses = ['draft', 'submitted', 'received'];
  for (let i = 0; i < 3; i += 1) {
    const store = base.stores[0]!;
    const supplier = base.suppliers[i % base.suppliers.length]!;
    const poItems = base.variants.slice(i * 4, i * 4 + 3);
    const total = poItems.reduce((sum, v) => sum + v.cost * 20, 0);
    const po = await db.withTenant(base.tenantId, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO purchase_orders
          (tenant_id, store_id, supplier_id, number, status, order_date, expected_date, notes,
           subtotal_satang, tax_satang, total_satang, created_by, submitted_by, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE - $6::integer, CURRENT_DATE + 3,'ใบสั่งซื้อตัวอย่างสำหรับเดโม',
           $7,0,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          base.tenantId,
          store.id,
          supplier,
          poNumbers[i],
          poStatuses[i],
          i * 3,
          total,
          base.staff.find((s) => s.key === 'manager')!.userId,
          poStatuses[i] === 'draft' ? null : base.staff.find((s) => s.key === 'owner')!.userId,
          poStatuses[i] === 'received' ? base.staff.find((s) => s.key === 'owner')!.userId : null,
          poStatuses[i] === 'received' ? new Date().toISOString() : null,
        ],
      ),
    );
    let receivedTotal = total;
    if (poStatuses[i] === 'received') {
      const receipt = await db.withTenant(base.tenantId, (client) =>
        client.query<{ id: string }>(
          `INSERT INTO goods_receipts (tenant_id, purchase_order_id, store_id, number, received_by, note)
           VALUES ($1,$2,$3,'GR-DEMO-001',$4,'รับครบตามใบสั่งซื้อ') RETURNING id`,
          [base.tenantId, po.rows[0]!.id, store.id, base.staff.find((s) => s.key === 'inventory')!.userId],
        ),
      );
      for (const variant of poItems) {
        const line = await db.withTenant(base.tenantId, (client) =>
          client.query<{ id: string }>(
            `INSERT INTO purchase_order_items
              (tenant_id, purchase_order_id, variant_id, name_snapshot, sku_snapshot,
               qty_ordered, qty_received, unit_cost_satang, line_total_satang)
             VALUES ($1,$2,$3,$4,$5,20,20,$6,$7) RETURNING id`,
            [
              base.tenantId,
              po.rows[0]!.id,
              variant.id,
              `${variant.productName} · ${variant.variantName}`,
              variant.sku,
              variant.cost,
              variant.cost * 20,
            ],
          ),
        );
        await db.withTenant(base.tenantId, (client) =>
          client.query(
            `INSERT INTO goods_receipt_items
              (tenant_id, goods_receipt_id, po_item_id, variant_id, qty, unit_cost_satang)
             VALUES ($1,$2,$3,$4,20,$5)`,
            [base.tenantId, receipt.rows[0]!.id, line.rows[0]!.id, variant.id, variant.cost],
          ),
        );
        await db.withTenant(base.tenantId, (client) =>
          client.query(
            `INSERT INTO inventory_movements
              (tenant_id, store_id, variant_id, type, qty_delta, unit_cost_satang, reference_type, reference_id, reason, created_by)
             VALUES ($1,$2,$3,'purchase_receipt',20,$4,'goods_receipt',$5,'Demo receiving',$6)`,
            [
              base.tenantId,
              store.id,
              variant.id,
              variant.cost,
              receipt.rows[0]!.id,
              base.staff.find((s) => s.key === 'inventory')!.userId,
            ],
          ),
        );
      }
      receivedTotal = total;
    } else {
      for (const variant of poItems) {
        await db.withTenant(base.tenantId, (client) =>
          client.query(
            `INSERT INTO purchase_order_items
              (tenant_id, purchase_order_id, variant_id, name_snapshot, sku_snapshot,
               qty_ordered, unit_cost_satang, line_total_satang)
             VALUES ($1,$2,$3,$4,$5,20,$6,$7)`,
            [
              base.tenantId,
              po.rows[0]!.id,
              variant.id,
              `${variant.productName} · ${variant.variantName}`,
              variant.sku,
              variant.cost,
              variant.cost * 20,
            ],
          ),
        );
      }
    }
    void receivedTotal;
  }

  await db.withTenant(base.tenantId, (client) =>
    client.query(
      `INSERT INTO notifications (tenant_id, store_id, type, severity, title, body, link)
       VALUES
        ($1,$2,'purchase_approval','info','ใบสั่งซื้อรออนุมัติ','PO-DEMO-002 รอการอนุมัติจากผู้จัดการ','/purchasing'),
        ($1,$2,'system','info','ข้อมูลเดโมพร้อมใช้งาน','ข้อมูลตัวอย่างทั้งหมดถูกทำเครื่องหมายว่าเป็นเดโม','/settings')`,
      [base.tenantId, base.stores[0]!.id],
    ),
  );

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log('──────────────────────────────────────────────');
  console.log(' NEXORA POS demo ready');
  console.log('──────────────────────────────────────────────');
  console.log(` sales created:   ${saleCount}`);
  console.log(` refunds created: ${refundCount}`);
  console.log(` products:        ${base.variants.length} variants`);
  console.log(` time:            ${elapsed}s`);
  console.log('');
  console.log(' Store logins (password: NexoraDemo!2026)');
  console.log(`  owner      ${DEMO_EMAILS.owner}`);
  console.log(`  manager    ${DEMO_EMAILS.manager}`);
  console.log(`  cashier 1  ${DEMO_EMAILS.cashier1}`);
  console.log(`  cashier 2  ${DEMO_EMAILS.cashier2}`);
  console.log(`  inventory  ${DEMO_EMAILS.inventory}`);
  console.log(`  accountant ${DEMO_EMAILS.accountant}`);
  console.log('');
  console.log(' Platform admin (password: NexoraAdmin!2026)');
  console.log('  admin@nexora.local');
  console.log('──────────────────────────────────────────────');

  await db.close();
}

main().catch(async (error) => {
  console.error('seed failed:', error);
  process.exit(1);
});
