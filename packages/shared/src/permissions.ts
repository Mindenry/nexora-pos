export type PermissionCode =
  | 'products.read'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  | 'inventory.read'
  | 'inventory.adjust'
  | 'inventory.transfer'
  | 'inventory.count'
  | 'sales.read'
  | 'sales.create'
  | 'sales.cancel'
  | 'refunds.create'
  | 'payments.read'
  | 'payments.confirm'
  | 'shifts.read'
  | 'shifts.open'
  | 'shifts.close'
  | 'shifts.cash'
  | 'customers.read'
  | 'customers.manage'
  | 'promotions.manage'
  | 'purchasing.read'
  | 'purchasing.manage'
  | 'purchasing.approve'
  | 'suppliers.manage'
  | 'employees.manage'
  | 'reports.view'
  | 'reports.export'
  | 'settings.manage'
  | 'audit.view'
  | 'platform.manage';

export interface PermissionDefinition {
  code: PermissionCode;
  module: string;
  labelTh: string;
  labelEn: string;
}

export const PERMISSIONS: PermissionDefinition[] = [
  { code: 'products.read', module: 'products', labelTh: 'ดูสินค้า', labelEn: 'View products' },
  { code: 'products.create', module: 'products', labelTh: 'เพิ่มสินค้า', labelEn: 'Create products' },
  { code: 'products.update', module: 'products', labelTh: 'แก้ไขสินค้า', labelEn: 'Edit products' },
  { code: 'products.delete', module: 'products', labelTh: 'เก็บสินค้า', labelEn: 'Archive products' },
  { code: 'inventory.read', module: 'inventory', labelTh: 'ดูสต๊อก', labelEn: 'View inventory' },
  { code: 'inventory.adjust', module: 'inventory', labelTh: 'ปรับสต๊อก', labelEn: 'Adjust stock' },
  { code: 'inventory.transfer', module: 'inventory', labelTh: 'โอนสินค้า', labelEn: 'Transfer stock' },
  { code: 'inventory.count', module: 'inventory', labelTh: 'ตรวจนับสต๊อก', labelEn: 'Count stock' },
  { code: 'sales.read', module: 'sales', labelTh: 'ดูยอดขาย', labelEn: 'View sales' },
  { code: 'sales.create', module: 'sales', labelTh: 'ขายสินค้า', labelEn: 'Create sales' },
  { code: 'sales.cancel', module: 'sales', labelTh: 'ยกเลิกการขาย', labelEn: 'Void sales' },
  { code: 'refunds.create', module: 'refunds', labelTh: 'คืนสินค้า', labelEn: 'Create refunds' },
  { code: 'payments.read', module: 'payments', labelTh: 'ดูการชำระเงิน', labelEn: 'View payments' },
  { code: 'payments.confirm', module: 'payments', labelTh: 'ยืนยันการชำระเงิน', labelEn: 'Confirm payments' },
  { code: 'shifts.read', module: 'shifts', labelTh: 'ดูกะ', labelEn: 'View shifts' },
  { code: 'shifts.open', module: 'shifts', labelTh: 'เปิดกะ', labelEn: 'Open shifts' },
  { code: 'shifts.close', module: 'shifts', labelTh: 'ปิดกะ', labelEn: 'Close shifts' },
  { code: 'shifts.cash', module: 'shifts', labelTh: 'รับ/จ่ายเงินสด', labelEn: 'Cash in/out' },
  { code: 'customers.read', module: 'customers', labelTh: 'ดูลูกค้า', labelEn: 'View customers' },
  { code: 'customers.manage', module: 'customers', labelTh: 'จัดการลูกค้า', labelEn: 'Manage customers' },
  { code: 'promotions.manage', module: 'promotions', labelTh: 'จัดการโปรโมชั่น', labelEn: 'Manage promotions' },
  { code: 'purchasing.read', module: 'purchasing', labelTh: 'ดูใบสั่งซื้อ', labelEn: 'View purchase orders' },
  { code: 'purchasing.manage', module: 'purchasing', labelTh: 'จัดการใบสั่งซื้อ', labelEn: 'Manage purchase orders' },
  { code: 'purchasing.approve', module: 'purchasing', labelTh: 'อนุมัติใบสั่งซื้อ', labelEn: 'Approve purchase orders' },
  { code: 'suppliers.manage', module: 'suppliers', labelTh: 'จัดการผู้จำหน่าย', labelEn: 'Manage suppliers' },
  { code: 'employees.manage', module: 'employees', labelTh: 'จัดการพนักงาน', labelEn: 'Manage employees' },
  { code: 'reports.view', module: 'reports', labelTh: 'ดูรายงาน', labelEn: 'View reports' },
  { code: 'reports.export', module: 'reports', labelTh: 'ส่งออกรายงาน', labelEn: 'Export reports' },
  { code: 'settings.manage', module: 'settings', labelTh: 'จัดการการตั้งค่า', labelEn: 'Manage settings' },
  { code: 'audit.view', module: 'audit', labelTh: 'ดูประวัติการทำงาน', labelEn: 'View audit log' },
  { code: 'platform.manage', module: 'platform', labelTh: 'จัดการแพลตฟอร์ม', labelEn: 'Manage platform' },
];

export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code);
export const ALL_TENANT_PERMISSIONS = PERMISSION_CODES.filter((c) => c !== 'platform.manage');

export interface RoleDefinition {
  code: string;
  nameTh: string;
  nameEn: string;
  scope: 'tenant' | 'assigned';
  permissions: PermissionCode[];
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: 'owner',
    nameTh: 'เจ้าของธุรกิจ',
    nameEn: 'Business Owner',
    scope: 'tenant',
    permissions: ALL_TENANT_PERMISSIONS,
  },
  {
    code: 'manager',
    nameTh: 'ผู้จัดการสาขา',
    nameEn: 'Store Manager',
    scope: 'tenant',
    permissions: [
      'products.read', 'products.create', 'products.update', 'products.delete',
      'inventory.read', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
      'sales.read', 'sales.create', 'sales.cancel', 'refunds.create',
      'payments.read', 'payments.confirm',
      'shifts.read', 'shifts.open', 'shifts.close', 'shifts.cash',
      'customers.read', 'customers.manage', 'promotions.manage',
      'purchasing.read', 'purchasing.manage', 'purchasing.approve', 'suppliers.manage',
      'employees.manage', 'reports.view', 'reports.export', 'settings.manage',
    ],
  },
  {
    code: 'cashier',
    nameTh: 'แคชเชียร์',
    nameEn: 'Cashier',
    scope: 'assigned',
    permissions: [
      'products.read', 'inventory.read',
      'sales.read', 'sales.create', 'refunds.create',
      'payments.read', 'payments.confirm',
      'shifts.read', 'shifts.open', 'shifts.close', 'shifts.cash',
      'customers.read', 'customers.manage',
    ],
  },
  {
    code: 'inventory',
    nameTh: 'พนักงานคลังสินค้า',
    nameEn: 'Inventory Staff',
    scope: 'assigned',
    permissions: [
      'products.read', 'products.create', 'products.update',
      'inventory.read', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
      'purchasing.read', 'purchasing.manage', 'suppliers.manage',
      'reports.view',
    ],
  },
  {
    code: 'accountant',
    nameTh: 'นักบัญชี',
    nameEn: 'Accountant',
    scope: 'tenant',
    permissions: [
      'products.read', 'inventory.read', 'sales.read', 'payments.read',
      'purchasing.read', 'reports.view', 'reports.export', 'audit.view',
    ],
  },
];

export function roleByCode(code: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((r) => r.code === code);
}
