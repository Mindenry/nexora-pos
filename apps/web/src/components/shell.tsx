import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  Boxes,
  CheckCheck,
  ChevronDown,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  Search,
  Settings,
  Shield,
  Store,
  Sun,
  Tag,
  Truck,
  UserCog,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { formatDateTime } from '@nexora/shared';
import { Badge, Button, cn, Input, Modal, Spinner } from './ui';

interface NavItem {
  to: string;
  icon: typeof LayoutDashboard;
  labelTh: string;
  labelEn: string;
  permission?: string;
  platformOnly?: boolean;
  end?: boolean;
}

const NAV_GROUPS: Array<{ key: string; labelTh: string; labelEn: string; items: NavItem[] }> = [
  {
    key: 'operate',
    labelTh: 'ปฏิบัติการ',
    labelEn: 'Operate',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, labelTh: 'ภาพรวม', labelEn: 'Overview', permission: 'reports.view' },
      { to: '/pos', icon: Monitor, labelTh: 'ขายหน้าร้าน', labelEn: 'Point of sale', permission: 'sales.create' },
      { to: '/sales', icon: Receipt, labelTh: 'รายการขาย', labelEn: 'Sales', permission: 'sales.read' },
      { to: '/shifts', icon: Clock, labelTh: 'กะและเงินสด', labelEn: 'Shifts & cash', permission: 'shifts.read' },
    ],
  },
  {
    key: 'catalog',
    labelTh: 'สินค้าและสต๊อก',
    labelEn: 'Catalog & stock',
    items: [
      { to: '/products', icon: Package, labelTh: 'สินค้า', labelEn: 'Products', permission: 'products.read' },
      { to: '/inventory', icon: Boxes, labelTh: 'สต๊อกสินค้า', labelEn: 'Inventory', permission: 'inventory.read' },
      { to: '/purchasing', icon: Truck, labelTh: 'จัดซื้อ', labelEn: 'Purchasing', permission: 'purchasing.read' },
    ],
  },
  {
    key: 'customers',
    labelTh: 'ลูกค้าและการตลาด',
    labelEn: 'Customers & growth',
    items: [
      { to: '/customers', icon: Users, labelTh: 'ลูกค้า', labelEn: 'Customers', permission: 'customers.read' },
      { to: '/promotions', icon: Tag, labelTh: 'โปรโมชั่น', labelEn: 'Promotions', permission: 'promotions.manage' },
      { to: '/reports', icon: BarChart3, labelTh: 'รายงาน', labelEn: 'Reports', permission: 'reports.view' },
    ],
  },
  {
    key: 'admin',
    labelTh: 'บริหารร้าน',
    labelEn: 'Administration',
    items: [
      { to: '/employees', icon: UserCog, labelTh: 'พนักงาน', labelEn: 'Employees', permission: 'employees.manage' },
      { to: '/settings', icon: Settings, labelTh: 'ตั้งค่า', labelEn: 'Settings', permission: 'settings.manage' },
    ],
  },
];

const PAGE_TITLES: Array<{ prefix: string; th: string; en: string }> = [
  { prefix: '/dashboard', th: 'ภาพรวมธุรกิจ', en: 'Business overview' },
  { prefix: '/pos', th: 'ขายหน้าร้าน', en: 'Point of sale' },
  { prefix: '/sales', th: 'รายการขาย', en: 'Sales' },
  { prefix: '/shifts', th: 'กะและเงินสด', en: 'Shifts & cash' },
  { prefix: '/products', th: 'สินค้า', en: 'Products' },
  { prefix: '/inventory', th: 'สต๊อกสินค้า', en: 'Inventory' },
  { prefix: '/purchasing', th: 'จัดซื้อ', en: 'Purchasing' },
  { prefix: '/customers', th: 'ลูกค้า', en: 'Customers' },
  { prefix: '/promotions', th: 'โปรโมชั่น', en: 'Promotions' },
  { prefix: '/reports', th: 'รายงาน', en: 'Reports' },
  { prefix: '/employees', th: 'พนักงาน', en: 'Employees' },
  { prefix: '/settings', th: 'ตั้งค่า', en: 'Settings' },
  { prefix: '/onboarding', th: 'เริ่มต้นใช้งาน', en: 'Getting started' },
  { prefix: '/platform', th: 'แพลตฟอร์ม', en: 'Platform' },
];

export function usePageTitle(): { th: string; en: string } {
  const { pathname } = useLocation();
  const found = PAGE_TITLES.find((item) => pathname.startsWith(item.prefix));
  return found ?? { th: 'NEXORA POS', en: 'NEXORA POS' };
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5">{eyebrow}</div> : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-text sm:text-[26px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('mx-auto w-full animate-rise px-4 py-5 sm:px-6 lg:px-7', wide ? 'max-w-[1800px]' : 'max-w-[1500px]')}>
      {children}
    </div>
  );
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5 px-1" aria-label="NEXORA POS home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-jade text-[15px] font-bold text-white">
        N
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold tracking-[0.16em] text-sidebar-text">NEXORA</span>
          <span className="block text-[9px] font-medium uppercase tracking-[0.24em] text-sidebar-muted">
            Retail OS
          </span>
        </span>
      ) : null}
    </Link>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can, isPlatformAdmin } = useAuth();
  const { t } = useLang();
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2 no-scrollbar">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => (item.permission ? can(item.permission) : true));
        if (items.length === 0) return null;
        return (
          <div key={group.key} className="mb-4">
            {!collapsed ? (
              <p className="px-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">
                {t(group.labelTh, group.labelEn)}
              </p>
            ) : (
              <div className="mx-2 mb-2 h-px bg-white/8" />
            )}
            <div className="space-y-0.5">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  title={collapsed ? t(item.labelTh, item.labelEn) : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-colors',
                      isActive
                        ? 'bg-white/[0.08] text-sidebar-text'
                        : 'text-sidebar-muted hover:bg-white/[0.045] hover:text-sidebar-text',
                      collapsed && 'justify-center px-2',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-jade" />
                      ) : null}
                      <item.icon className="h-[16px] w-[16px] shrink-0" strokeWidth={1.8} />
                      {!collapsed ? <span className="truncate">{t(item.labelTh, item.labelEn)}</span> : null}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
      {isPlatformAdmin ? (
        <div className="mb-4">
          {!collapsed ? (
            <p className="px-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">
              {t('แพลตฟอร์ม', 'Platform')}
            </p>
          ) : (
            <div className="mx-2 mb-2 h-px bg-white/8" />
          )}
          <NavLink
            to="/platform"
            onClick={onNavigate}
            title={collapsed ? t('ผู้ดูแลแพลตฟอร์ม', 'Platform admin') : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-colors',
                isActive
                  ? 'bg-white/[0.08] text-sidebar-text'
                  : 'text-sidebar-muted hover:bg-white/[0.045] hover:text-sidebar-text',
                collapsed && 'justify-center px-2',
              )
            }
          >
            <Shield className="h-[16px] w-[16px] shrink-0" strokeWidth={1.8} />
            {!collapsed ? <span>{t('ผู้ดูแลแพลตฟอร์ม', 'Platform admin')}</span> : null}
          </NavLink>
        </div>
      ) : null}
    </nav>
  );
}

function StoreSwitcher() {
  const { me, storeId, setStore } = useAuth();
  const { t } = useLang();
  if (!me || me.stores.length === 0) return null;
  if (me.stores.length === 1) {
    return (
      <div className="hidden items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-muted lg:flex">
        <Store className="h-3.5 w-3.5" />
        <span className="font-medium text-text">{me.stores[0]!.name}</span>
      </div>
    );
  }
  return (
    <label className="hidden items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-muted lg:flex">
      <Store className="h-3.5 w-3.5 shrink-0" />
      <span className="sr-only">{t('สาขา', 'Branch')}</span>
      <select
        value={storeId ?? ''}
        onChange={(event) => setStore(event.target.value)}
        className="max-w-[160px] cursor-pointer bg-transparent py-0.5 text-[12px] font-medium text-text focus:outline-none"
      >
        {me.stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3 w-3 shrink-0" />
    </label>
  );
}

interface NotificationRow {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, locale } = useLang();
  const { can } = useAuth();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationRow[]>('/notifications', { storeId: null }),
    refetchInterval: 60_000,
    enabled: can('sales.read'),
  });
  const unread = Number(query.data?.meta?.unreadCount ?? 0);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markAll = async () => {
    await api('/notifications/read-all', { method: 'POST', body: {}, storeId: null });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('การแจ้งเตือน', 'Notifications')}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors hover:text-text"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-40 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-line bg-surface elevated">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-[13px] font-semibold">{t('การแจ้งเตือน', 'Notifications')}</p>
            <button
              type="button"
              onClick={() => void markAll()}
              className="flex items-center gap-1 text-[11px] text-jade hover:underline"
            >
              <CheckCheck className="h-3 w-3" />
              {t('อ่านทั้งหมด', 'Mark all read')}
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {query.isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (query.data?.data ?? []).length === 0 ? (
              <p className="px-4 py-10 text-center text-[12px] text-faint">
                {t('ไม่มีการแจ้งเตือน', 'No notifications')}
              </p>
            ) : (
              (query.data?.data ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={async () => {
                    if (!item.readAt) {
                      await api(`/notifications/${item.id}/read`, { method: 'POST', body: {}, storeId: null });
                      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
                    }
                    setOpen(false);
                    if (item.link) navigate(item.link);
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors hover:bg-surface-2',
                    !item.readAt && 'bg-jade-soft/30',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      item.severity === 'critical'
                        ? 'bg-danger'
                        : item.severity === 'warning'
                          ? 'bg-amber'
                          : 'bg-jade',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-text">{item.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[11.5px] text-muted">{item.body}</span>
                    <span className="mt-1 block text-[10px] text-faint">
                      {formatDateTime(item.createdAt, locale)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const { t, locale, setLocale } = useLang();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!me) return null;
  const initials = me.user.name.slice(0, 1).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1 pr-2 transition-colors hover:border-line-strong"
        aria-label={t('เมนูผู้ใช้', 'User menu')}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white" style={{ background: 'var(--text)' }}>
          {initials}
        </span>
        <span className="hidden max-w-[110px] truncate text-[12px] font-medium text-text sm:block">
          {me.user.name}
        </span>
        <ChevronDown className="h-3 w-3 text-faint" />
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-line bg-surface elevated">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-[13px] font-semibold text-text">{me.user.name}</p>
            <p className="truncate text-[11px] text-muted">{me.user.email}</p>
            <p className="mt-1 text-[10.5px] text-faint">
              {me.roles.map((r) => r).join(', ') || (me.user.isPlatformAdmin ? 'platform admin' : '')}
            </p>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              onClick={() => {
                setLocale(locale === 'th' ? 'en' : 'th');
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-text"
            >
              <span>{t('ภาษา', 'Language')}</span>
              <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium">
                {locale === 'th' ? 'ไทย' : 'EN'}
              </span>
            </button>
            <button
              type="button"
              onClick={toggle}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-text"
            >
              <span>{t('ธีม', 'Theme')}</span>
              <span className="flex items-center gap-1 text-[10px]">
                {theme === 'light' ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                {theme === 'light' ? t('สว่าง', 'Light') : t('มืด', 'Dark')}
              </span>
            </button>
            {me.employee ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/settings');
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-text"
              >
                <Settings className="h-3.5 w-3.5" />
                {t('ตั้งค่าร้าน', 'Store settings')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-danger hover:bg-danger-soft"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('ออกจากระบบ', 'Sign out')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, isPlatformAdmin } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const actions = useMemo(() => {
    const list: Array<{ label: string; hint: string; to: string; permission?: string }> = [];
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.permission && !can(item.permission)) continue;
        list.push({
          label: t(item.labelTh, item.labelEn),
          hint: t(group.labelTh, group.labelEn),
          to: item.to,
          permission: item.permission,
        });
      }
    }
    if (isPlatformAdmin) {
      list.push({ label: t('ผู้ดูแลแพลตฟอร์ม', 'Platform admin'), hint: t('แพลตฟอร์ม', 'Platform'), to: '/platform' });
    }
    if (can('products.create')) {
      list.unshift({
        label: t('เพิ่มสินค้าใหม่', 'Add a product'),
        hint: t('ทางลัด', 'Quick action'),
        to: '/products?new=1',
      });
    }
    if (can('sales.create')) {
      list.unshift({
        label: t('เปิดหน้าขาย', 'Open point of sale'),
        hint: t('ทางลัด', 'Quick action'),
        to: '/pos',
      });
    }
    return list;
  }, [can, isPlatformAdmin, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.slice(0, 12);
    return actions
      .filter((a) => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q))
      .slice(0, 12);
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} size="md" title={t('ไปที่ / ค้นหา', 'Go to / search')}>
      <div className="-mt-1 space-y-3">
        <Input
          data-autofocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((i) => Math.min(filtered.length - 1, i + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (event.key === 'Enter' && filtered[index]) {
              navigate(filtered[index]!.to);
              onClose();
            }
          }}
          placeholder={t('ค้นหาหน้า การกระทำ…', 'Search pages and actions…')}
          leadingIcon={<Search className="h-4 w-4" />}
        />
        <div className="max-h-[360px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-faint">{t('ไม่พบรายการ', 'Nothing found')}</p>
          ) : (
            filtered.map((action, i) => (
              <button
                key={`${action.to}-${action.label}`}
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  navigate(action.to);
                  onClose();
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]',
                  i === index ? 'bg-jade-soft text-text' : 'text-muted hover:bg-surface-2',
                )}
              >
                <span>{action.label}</span>
                <span className="text-[10.5px] text-faint">{action.hint}</span>
              </button>
            ))
          )}
        </div>
        <p className="border-t border-line pt-2 text-[10.5px] text-faint">
          {t('↑↓ เลือก • Enter เปิด • Esc ปิด', '↑↓ to move • Enter to open • Esc to close')}
        </p>
      </div>
    </Modal>
  );
}

export function AppShell() {
  const { me, isDemo, setStore } = useAuth();
  const { t } = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const pageTitle = usePageTitle();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('nexora.nav_collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    localStorage.setItem('nexora.nav_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-white/5 bg-sidebar transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[68px]' : 'w-[236px]',
        )}
      >
        <div className={cn('flex h-14 items-center border-b border-white/5', collapsed ? 'justify-center' : 'px-3')}>
          <Logo compact={collapsed} />
        </div>
        <SidebarNav collapsed={collapsed} />
        <div className={cn('border-t border-white/5 p-2', collapsed && 'flex justify-center')}>
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="rounded-md p-2 text-sidebar-muted hover:bg-white/5 hover:text-sidebar-text"
              aria-label={t('ขยายเมนู', 'Expand navigation')}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] text-sidebar-muted">v0.1</span>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="rounded-md p-1.5 text-sidebar-muted hover:bg-white/5 hover:text-sidebar-text"
                aria-label={t('ย่อเมนู', 'Collapse navigation')}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-[260px] flex-col bg-sidebar">
            <div className="flex h-14 items-center justify-between border-b border-white/5 px-3">
              <Logo />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1.5 text-sidebar-muted hover:bg-white/5"
                aria-label={t('ปิดเมนู', 'Close navigation')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {me && me.stores.length > 1 ? (
              <div className="border-b border-white/5 px-3 py-2.5">
                <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-sidebar-muted">
                  <Store className="h-3.5 w-3.5" />
                  {t('สาขา', 'Branch')}
                </label>
                <select
                  value={me.store?.id ?? ''}
                  onChange={(event) => setStore(event.target.value)}
                  className="mt-1 w-full rounded-md border border-white/10 bg-sidebar-2 px-2 py-1.5 text-[12px] text-sidebar-text focus:outline-none"
                >
                  {me.stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className={cn('min-h-screen transition-[padding] duration-200', collapsed ? 'lg:pl-[68px]' : 'lg:pl-[236px]')}>
        <header className="sticky top-0 z-30 border-b border-line bg-bg">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <button
              type="button"
              className="rounded-md p-2 text-muted hover:bg-surface-3 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t('เปิดเมนู', 'Open navigation')}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[13.5px] font-semibold text-text">{t(pageTitle.th, pageTitle.en)}</h2>
                {isDemo ? (
                  <Badge tone="amber" className="hidden xl:inline-flex">
                    {t('ข้อมูลเดโม', 'Demo data')}
                  </Badge>
                ) : null}
              </div>
              <p className="hidden truncate text-[10.5px] text-faint xl:block">
                {me?.tenant?.name ?? 'NEXORA Platform'} · {me?.store?.name ?? ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[12px] text-faint transition-colors hover:border-line-strong xl:flex"
            >
              <Search className="h-3.5 w-3.5" />
              <span>{t('ค้นหา…', 'Search…')}</span>
              <kbd className="ml-4 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[9.5px]">Ctrl K</kbd>
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="rounded-md p-2 text-muted hover:bg-surface-3 xl:hidden"
              aria-label={t('ค้นหา', 'Search')}
            >
              <Search className="h-4 w-4" />
            </button>
            <StoreSwitcher />
            <span
              className={cn(
                'hidden h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] xl:flex',
                online
                  ? 'border-line bg-surface text-muted'
                  : 'border-amber/30 bg-amber-soft text-amber',
              )}
              title={online ? t('ออนไลน์', 'Online') : t('ออฟไลน์', 'Offline')}
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            </span>
            {me?.employee ? (
              <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => navigate('/pos')} className="hidden xl:inline-flex">
                {t('ขายสินค้า', 'New sale')}
              </Button>
            ) : null}
            <NotificationsButton />
            <UserMenu />
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Spinner />
          NEXORA
        </div>
      </div>
    );
  }
  if (!me) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <Shield className="mx-auto mb-3 h-8 w-8 text-faint" />
          <p className="text-sm font-medium">ไม่มีสิทธิ์เข้าถึงหน้านี้</p>
          <p className="mt-1 text-[12px] text-muted">You do not have permission for this page.</p>
          <Link to="/pos" className="mt-4 inline-block text-[12px] font-medium text-jade hover:underline">
            กลับหน้าขาย / Back to POS
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
