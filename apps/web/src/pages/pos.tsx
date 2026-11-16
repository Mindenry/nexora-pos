import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CloudOff,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Minus,
  MonitorUp,
  PauseCircle,
  Percent,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  RefreshCw,
  ScanBarcode,
  Search,
  Store,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  Wifi,
  X,
} from 'lucide-react';
import {
  quoteCart,
  uuidv7,
  type Discount,
  type QuotePromotion,
} from '@nexora/shared';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import {
  cacheBootstrap,
  clearSynced,
  enqueueSale,
  listOutbox,
  readCachedBootstrap,
  updateOutbox,
  type OutboxItem,
} from '../lib/offline';
import { printReceipt } from '../lib/print';
import { publishDisplay } from '../lib/display';
import { categoryArt } from '../lib/art';
import { MoneyInput } from '../components/money-input';
import { ReceiptView, type ReceiptSnapshot } from '../components/receipt';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  SearchInput,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '../components/ui';

interface PosVariant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceSatang: number;
  costSatang: number;
  attributes: Record<string, string>;
  onHand: number;
  trackInventory: boolean;
}

interface PosProduct {
  id: string;
  name: string;
  categoryId: string | null;
  imageUrl: string;
  trackInventory: boolean;
  reorderPoint: number;
  taxRateBp: number | null;
  onHand: number;
  variants: PosVariant[];
}

interface ShiftSummary {
  shift: { id: string; business_date: string; opened_at: string; status: string };
  salesCount: number;
  salesTotalSatang: number;
  openingCashSatang: number;
  expectedCashSatang: number;
  varianceSatang: number | null;
  countedCashSatang: number | null;
}

interface PosBootstrap {
  serverTime: string;
  business: {
    name: string;
    legalName: string;
    taxId: string;
    address: string;
    phone: string;
    vatRateBp: number;
    pricesIncludeTax: boolean;
    receiptFooter: string;
    offlineCashEnabled: boolean;
    loyaltyEarnPerBaht: number;
    pointValueSatang: number;
    loyaltyRedemptionEnabled: boolean;
  };
  store: { id: string; name: string; code: string; address: string; phone: string; timezone: string };
  employee: { id: string; displayName: string };
  tenant: { name: string; isDemo: boolean };
  permissions: string[];
  offline: { cashEnabled: boolean; catalogVersion: string };
  catalog: {
    categories: Array<{ id: string; name: string; parentId: string | null; sortOrder: number }>;
    products: PosProduct[];
  };
  paymentMethods: Array<{
    code: string;
    name: string;
    type: 'cash' | 'card' | 'qr' | 'transfer' | 'other';
    requiresReference: boolean;
  }>;
  shift: ShiftSummary | null;
  heldSales: Array<{ id: string; label: string; cart: unknown; createdAt: string }>;
  promotions: QuotePromotion[];
}

interface CartLine {
  variantId: string;
  productId: string;
  categoryId: string | null;
  name: string;
  sku: string;
  qty: number;
  unitPriceSatang: number;
  lineDiscount: Discount | null;
  trackInventory: boolean;
  onHand: number;
  taxRateBp: number | null;
  imageUrl: string;
}

interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
  tier: string;
  points?: number;
}

interface PaymentRow {
  key: string;
  method: string;
  amountSatang: number;
  tenderedSatang: number;
  reference: string;
}

interface CheckoutResult {
  saleId: string;
  number: string;
  status: string;
  totalSatang: number;
  changeSatang: number;
  taxSatang: number;
  discountSatang: number;
  loyaltyPoints: number;
  pointsRedeemed?: number;
  pointsDiscountSatang?: number;
  customerPointsBalance?: number | null;
  warnings: string[];
  replayed?: boolean;
  receipt: ReceiptSnapshot;
}

const DEVICE_KEY = 'nexora.device_id';
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuidv7();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function PosPage() {
  const { t, locale } = useLang();
  const { money, number, dateTime } = useFormat();
  const { me, setStore, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [online, setOnline] = useState(navigator.onLine);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderDiscount, setOrderDiscount] = useState<Discount | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponOpen, setCouponOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [now, setNow] = useState(new Date());

  const [variantPicker, setVariantPicker] = useState<PosProduct | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [discountTarget, setDiscountTarget] = useState<'order' | { line: string } | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftPanelOpen, setShiftPanelOpen] = useState(false);
  const [cashModal, setCashModal] = useState<'cash_in' | 'cash_out' | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [mobileCart, setMobileCart] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [success, setSuccess] = useState<CheckoutResult | null>(null);
  const [lastSale, setLastSale] = useState<CheckoutResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [localDelta, setLocalDelta] = useState<Map<string, number>>(new Map());
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const autoShiftPrompted = useRef(false);

  const query = useQuery({
    queryKey: ['pos-bootstrap'],
    queryFn: async () => {
      const result = await api<PosBootstrap>('/pos/bootstrap');
      cacheBootstrap(result.data);
      return result.data;
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const cached = readCachedBootstrap<PosBootstrap>();
  const data = query.data ?? (!online || query.isError ? cached?.value : undefined);
  const offline = !online;

  useEffect(() => {
    if (query.data) {
      setLocalDelta(new Map());
    }
  }, [query.data]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'F4' && cart.length > 0 && !checkoutOpen) {
        event.preventDefault();
        openCheckout();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const refreshOutbox = useCallback(async () => {
    setOutbox(await listOutbox());
  }, []);

  useEffect(() => {
    void refreshOutbox();
  }, [refreshOutbox]);

  useEffect(() => {
    if (data && !data.shift && !autoShiftPrompted.current && online) {
      autoShiftPrompted.current = true;
      setShiftOpen(true);
    }
  }, [data, online]);

  const variantsById = useMemo(() => {
    const map = new Map<string, { product: PosProduct; variant: PosVariant }>();
    for (const product of data?.catalog.products ?? []) {
      for (const variant of product.variants) map.set(variant.id, { product, variant });
    }
    return map;
  }, [data]);

  const stockOf = useCallback(
    (variant: PosVariant) => variant.onHand + (localDelta.get(variant.id) ?? 0),
    [localDelta],
  );

  const buildQuote = useCallback(
    (extraDiscountSatang: number) => {
      if (!data || cart.length === 0) return null;
      try {
        return quoteCart({
          lines: cart.map((line) => ({
            key: line.variantId,
            variantId: line.variantId,
            productId: line.productId,
            categoryId: line.categoryId,
            name: line.name,
            sku: line.sku,
            qty: line.qty,
            unitPriceSatang: line.unitPriceSatang,
            unitCostSatang: 0,
            lineDiscount: line.lineDiscount,
          })),
          orderDiscount,
          couponCode: couponCode.trim() || null,
          promotions: data.promotions,
          taxRateBp: data.business.vatRateBp,
          pricesIncludeTax: data.business.pricesIncludeTax,
          memberDiscountBp: 0,
          extraDiscountSatang,
        });
      } catch {
        return null;
      }
    },
    [data, cart, orderDiscount, couponCode],
  );

  const baseQuote = useMemo(() => buildQuote(0), [buildQuote]);
  const pointValue = data?.business.pointValueSatang ?? 0;
  const maxRedeemable =
    customer && pointValue > 0
      ? Math.min(customer.points ?? 0, Math.floor((baseQuote?.totalSatang ?? 0) / pointValue))
      : 0;
  const pointsUsed = Math.min(redeemPoints, maxRedeemable);
  const pointsDiscount = pointsUsed * pointValue;
  const quote = useMemo(
    () => (pointsDiscount > 0 ? buildQuote(pointsDiscount) : baseQuote),
    [baseQuote, buildQuote, pointsDiscount],
  );

  useEffect(() => {
    if (redeemPoints > maxRedeemable) setRedeemPoints(maxRedeemable);
  }, [redeemPoints, maxRedeemable]);

  const total = quote?.totalSatang ?? 0;

  useEffect(() => {
    if (!data || success) return;
    const timer = window.setTimeout(() => {
      if (cart.length === 0 || !quote) {
        publishDisplay({
          kind: 'idle',
          storeName: data.store.name,
          businessName: data.business.name,
        });
        return;
      }
      publishDisplay({
        kind: 'cart',
        storeName: data.store.name,
        businessName: data.business.name,
        lines: quote.lines.map((line) => {
          const source = cart.find((item) => item.variantId === line.variantId);
          return {
            name: line.name,
            qty: line.qty,
            unitPriceSatang: line.unitPriceSatang,
            totalSatang: line.totalSatang,
            imageUrl: source?.imageUrl,
          };
        }),
        itemCount: quote.itemCount,
        subtotalSatang: quote.subtotalSatang,
        discountSatang: quote.discountSatang,
        taxSatang: quote.taxSatang,
        totalSatang: quote.totalSatang,
        pricesIncludeTax: data.business.pricesIncludeTax,
        vatRateBp: data.business.vatRateBp,
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [data, cart, quote, success]);

  const openCustomerDisplay = () => {
    const popup = window.open(
      '/display',
      'nexora-customer-display',
      'popup=yes,width=1280,height=800,menubar=no,toolbar=no,location=no,status=no',
    );
    if (!popup) {
      toast.info(
        t('เบราว์เซอร์บล็อกหน้าต่างใหม่', 'Popup blocked'),
        t('อนุญาตป๊อปอัปเพื่อเปิดจอลูกค้า', 'Allow popups to open the customer display.'),
      );
      return;
    }
    popup.focus();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      const request = document.documentElement.requestFullscreen?.();
      request?.catch(() => undefined);
    }
  };

  const addVariant = useCallback(
    (product: PosProduct, variant: PosVariant) => {
      const available = stockOf(variant);
      if (variant.trackInventory && available <= 0) {
        toast.error(t('สินค้าหมดสต๊อก', 'Out of stock'), `${product.name} · ${variant.name}`);
        return;
      }
      setCart((prev) => {
        const existing = prev.find((line) => line.variantId === variant.id);
        if (existing) {
          const nextQty = existing.qty + 1;
          if (variant.trackInventory && nextQty > available) {
            toast.error(t('จำนวนเกินสต๊อกที่มี', 'Exceeds available stock'), `${available}`);
            return prev;
          }
          return prev.map((line) =>
            line.variantId === variant.id ? { ...line, qty: nextQty, onHand: available } : line,
          );
        }
        return [
          ...prev,
          {
            variantId: variant.id,
            productId: product.id,
            categoryId: product.categoryId,
            name: `${product.name}${variant.name && variant.name !== 'มาตรฐาน' ? ` · ${variant.name}` : ''}`,
            sku: variant.sku ?? '',
            qty: 1,
            unitPriceSatang: variant.priceSatang,
            lineDiscount: null,
            trackInventory: variant.trackInventory,
            onHand: available,
            taxRateBp: product.taxRateBp,
            imageUrl: product.imageUrl,
          },
        ];
      });
    },
    [stockOf, t, toast],
  );

  const addProduct = useCallback(
    (product: PosProduct) => {
      if (product.variants.length === 1) addVariant(product, product.variants[0]!);
      else setVariantPicker(product);
    },
    [addVariant],
  );

  const changeQty = (variantId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.variantId !== variantId) return line;
          const next = line.qty + delta;
          if (next <= 0) return null;
          if (line.trackInventory && next > line.onHand) {
            toast.error(t('จำนวนเกินสต๊อกที่มี', 'Exceeds available stock'), `${line.onHand}`);
            return line;
          }
          return { ...line, qty: next };
        })
        .filter((line): line is CartLine => line !== null),
    );
  };

  const filteredProducts = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.catalog.products.filter((product) => {
      if (category && product.categoryId !== category) return false;
      if (!q) return true;
      return (
        product.name.toLowerCase().includes(q) ||
        product.variants.some(
          (v) => v.sku?.toLowerCase().includes(q) || v.barcode?.includes(q),
        )
      );
    });
  }, [data, search, category]);

  const submitSearch = async () => {
    if (!search.trim() || !data) return;
    const code = search.trim();
    const exact = data.catalog.products
      .flatMap((product) => product.variants.map((variant) => ({ product, variant })))
      .find(({ variant }) => variant.barcode === code || variant.sku === code);
    if (exact) {
      addVariant(exact.product, exact.variant);
      setSearch('');
      return;
    }
    if (filteredProducts.length === 1) {
      addProduct(filteredProducts[0]!);
      setSearch('');
      return;
    }
    try {
      const result = await api<
        Array<{
          variantId: string;
          productId: string;
          productName: string;
          variantName: string;
          sku: string | null;
          priceSatang: number;
          onHand: number;
          trackInventory: boolean;
        }>
      >(`/pos/lookup?code=${encodeURIComponent(code)}`);
      const first = result.data[0];
      if (!first) {
        toast.info(t('ไม่พบสินค้า', 'No product found'), code);
        return;
      }
      const found = variantsById.get(first.variantId);
      if (found) {
        addVariant(found.product, found.variant);
      } else {
        addVariant(
          {
            id: first.productId,
            name: first.productName,
            categoryId: null,
            imageUrl: '',
            trackInventory: first.trackInventory,
            reorderPoint: 0,
            taxRateBp: null,
            onHand: first.onHand,
            variants: [],
          },
          {
            id: first.variantId,
            name: first.variantName,
            sku: first.sku,
            barcode: code,
            priceSatang: first.priceSatang,
            costSatang: 0,
            attributes: {},
            onHand: first.onHand,
            trackInventory: first.trackInventory,
          },
        );
      }
      setSearch('');
    } catch (error) {
      toast.error(t('ค้นหาไม่สำเร็จ', 'Lookup failed'), errorMessage(error, locale));
    }
  };

  const paymentMethods = data?.paymentMethods ?? [];
  const defaultMethod = paymentMethods.find((m) => m.type === 'cash') ?? paymentMethods[0];

  const openCheckout = () => {
    if (!quote || cart.length === 0) return;
    if (!data) return;
    if (!data.shift && online) {
      setShiftOpen(true);
      return;
    }
    if (!data.shift && !online) {
      toast.error(t('ไม่มีกะที่เปิดอยู่', 'No cached open shift'), t('ไม่สามารถขายออฟไลน์ได้', 'Offline sale blocked'));
      return;
    }
    if (offline && !data.offline.cashEnabled) {
      toast.error(t('ร้านนี้ปิดการขายออฟไลน์', 'Offline sales are disabled'));
      return;
    }
    const method = defaultMethod;
    if (!method) {
      toast.error(t('ยังไม่ได้ตั้งค่าวิธีชำระเงิน', 'No payment method configured'));
      return;
    }
    setOperationId(uuidv7());
    setPayments([
      {
        key: uuidv7(),
        method: method.code,
        amountSatang: quote.totalSatang,
        tenderedSatang: method.type === 'cash' ? quote.totalSatang : quote.totalSatang,
        reference: '',
      },
    ]);
    setCheckoutOpen(true);
    setMobileCart(false);
  };

  const appliedTotal = payments.reduce((sum, row) => sum + row.amountSatang, 0);
  const changeTotal = payments.reduce(
    (sum, row) => {
      const method = paymentMethods.find((m) => m.code === row.method);
      if (method?.type === 'cash' && row.tenderedSatang > row.amountSatang) {
        return sum + (row.tenderedSatang - row.amountSatang);
      }
      return sum;
    },
    0,
  );
  const paymentValid =
    quote !== null &&
    appliedTotal === quote.totalSatang &&
    payments.length > 0 &&
    payments.every((row) => {
      const method = paymentMethods.find((m) => m.code === row.method);
      if (!method) return false;
      if (method.type === 'cash') return row.tenderedSatang >= row.amountSatang;
      return Boolean(row.reference.trim());
    }) &&
    (!offline || payments.every((row) => paymentMethods.find((m) => m.code === row.method)?.type === 'cash'));

  const syncOutbox = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const items = await listOutbox();
      for (const item of items) {
        if (item.status === 'synced') continue;
        try {
          const result = await api<CheckoutResult>('/pos/checkout', {
            method: 'POST',
            body: item.payload,
          });
          await updateOutbox({
            ...item,
            status: 'synced',
            saleNumber: result.data.number,
            receipt: result.data.receipt,
            error: undefined,
            attempts: item.attempts + 1,
          });
        } catch (error) {
          const apiError = error instanceof ApiError ? error : null;
          const permanent = apiError && apiError.status >= 400 && apiError.status < 500;
          await updateOutbox({
            ...item,
            status: permanent ? 'failed' : 'pending',
            error: errorMessage(error, locale),
            attempts: item.attempts + 1,
          });
          if (!permanent) break;
        }
      }
      await refreshOutbox();
      await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [locale, queryClient, refreshOutbox]);

  useEffect(() => {
    if (online) {
      void syncOutbox();
    }
  }, [online, syncOutbox]);

  const submitCheckout = async () => {
    if (!quote || !data || !operationId || !paymentValid) return;
    setSubmitting(true);
    const payload = {
      operationId,
      items: cart.map((line) => ({
        variantId: line.variantId,
        qty: line.qty,
        lineDiscount: line.lineDiscount ?? null,
      })),
      orderDiscount,
      couponCode: couponCode.trim() || undefined,
      customerId: customer?.id ?? null,
      payments: payments.map((row) => ({
        method: row.method,
        amountSatang: row.amountSatang,
        tenderedSatang: row.tenderedSatang,
        reference: row.reference || undefined,
      })),
      redeemPoints: pointsUsed > 0 ? pointsUsed : undefined,
      deviceId: deviceId(),
      occurredAt: new Date().toISOString(),
      offline,
    };

    if (offline) {
      const receipt: ReceiptSnapshot = {
        type: 'sale',
        number: `OFFLINE-${Date.now().toString().slice(-6)}`,
        businessDate: data.shift?.shift.business_date,
        issuedAt: new Date().toISOString(),
        business: data.business,
        store: data.store,
        cashier: data.employee.displayName,
        customer: customer ? { name: customer.name, phone: customer.phone ?? undefined } : null,
        items: quote.lines.map((line) => ({
          name: line.name,
          sku: line.sku,
          qty: line.qty,
          unitPriceSatang: line.unitPriceSatang,
          totalSatang: line.totalSatang,
        })),
        subtotalSatang: quote.subtotalSatang,
        discountSatang: quote.discountSatang,
        taxSatang: quote.taxSatang,
        totalSatang: quote.totalSatang,
        changeSatang: changeTotal,
        vatRateBp: data.business.vatRateBp,
        pricesIncludeTax: data.business.pricesIncludeTax,
        pointsRedeemed: pointsUsed,
        pointsDiscountSatang: pointsDiscount,
        payments: payments.map((row) => ({
          method: row.method,
          methodName: paymentMethods.find((m) => m.code === row.method)?.name,
          amountSatang: row.amountSatang,
          reference: row.reference,
        })),
        footer: data.business.receiptFooter,
      };
      await enqueueSale({
        operationId,
        payload,
        queuedAt: new Date().toISOString(),
        status: 'pending',
        attempts: 0,
        receipt,
      });
      setLocalDelta((prev) => {
        const next = new Map(prev);
        for (const line of cart) next.set(line.variantId, (next.get(line.variantId) ?? 0) - line.qty);
        return next;
      });
      await refreshOutbox();
      const result: CheckoutResult = {
        saleId: `offline-${operationId}`,
        number: receipt.number,
        status: 'pending_sync',
        totalSatang: quote.totalSatang,
        changeSatang: changeTotal,
        taxSatang: quote.taxSatang,
        discountSatang: quote.discountSatang,
        loyaltyPoints: 0,
        warnings: ['OFFLINE_QUEUED'],
        receipt,
      };
      setSuccess(result);
      setLastSale(result);
      setCheckoutOpen(false);
      setOperationId(null);
      resetCart();
      publishDisplay({
        kind: 'paid',
        storeName: data.store.name,
        businessName: data.business.name,
        number: receipt.number,
        totalSatang: quote.totalSatang,
        changeSatang: changeTotal,
      });
      toast.info(t('บันทึกการขายออฟไลน์แล้ว', 'Offline sale queued'), t('จะซิงก์เมื่อออนไลน์', 'Will sync when online'));
      setSubmitting(false);
      return;
    }

    try {
      const result = await api<CheckoutResult>('/pos/checkout', { method: 'POST', body: payload });
      setSuccess(result.data);
      setLastSale(result.data);
      setCheckoutOpen(false);
      setOperationId(null);
      resetCart();
      publishDisplay({
        kind: 'paid',
        storeName: data.store.name,
        businessName: data.business.name,
        number: result.data.number,
        totalSatang: result.data.totalSatang,
        changeSatang: result.data.changeSatang,
      });
      await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      if (result.data.warnings.includes('NEGATIVE_STOCK')) {
        toast.info(t('สต๊อกติดลบหลังการขาย', 'Stock went negative'), t('ตรวจสอบสต๊อก', 'Check inventory'));
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NETWORK' && data.offline.cashEnabled) {
        const cashOnly = payments.every(
          (row) => paymentMethods.find((m) => m.code === row.method)?.type === 'cash',
        );
        if (cashOnly) {
          setOnline(false);
          toast.info(
            t('การเชื่อมต่อขาดหาย — กำลังบันทึกแบบออฟไลน์', 'Connection lost — queueing offline'),
            t('กดชำระอีกครั้งเพื่อบันทึกคิว', 'Press pay again to queue it'),
          );
          setSubmitting(false);
          return;
        }
      }
      toast.error(t('ชำระเงินไม่สำเร็จ', 'Checkout failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const resetCart = () => {
    setCart([]);
    setOrderDiscount(null);
    setCouponCode('');
    setCouponOpen(false);
    setCustomer(null);
    setRedeemPoints(0);
  };

  const holdSale = async () => {
    if (cart.length === 0) return;
    try {
      await api('/pos/held', {
        method: 'POST',
        body: {
          label: t('พักบิล', 'Held') + ' ' + new Date().toLocaleTimeString(locale === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' }),
          cart: { lines: cart, orderDiscount, couponCode, customer },
        },
      });
      resetCart();
      await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
      toast.success(t('พักบิลแล้ว', 'Sale held'), t('เรียกคืนได้จากปุ่มพักบิล', 'Retrieve it from Held sales'));
    } catch (error) {
      toast.error(t('พักบิลไม่สำเร็จ', 'Could not hold sale'), errorMessage(error, locale));
    }
  };

  const retrieveHeld = (held: PosBootstrap['heldSales'][number]) => {
    const payload = held.cart as {
      lines?: CartLine[];
      orderDiscount?: Discount | null;
      couponCode?: string;
      customer?: CustomerLite | null;
    };
    const valid = (payload.lines ?? []).filter((line) => variantsById.has(line.variantId));
    setCart(valid);
    setOrderDiscount(payload.orderDiscount ?? null);
    setCouponCode(payload.couponCode ?? '');
    setCustomer(payload.customer ?? null);
    setHeldOpen(false);
    if (valid.length !== (payload.lines?.length ?? 0)) {
      toast.info(t('บางรายการไม่อยู่ในแคตตาล็อกแล้ว', 'Some items are no longer available'));
    }
  };

  const openHeld = async () => {
    setHeldOpen(true);
    await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
  };

  if (!me?.employee) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <p className="text-sm text-muted">Loading terminal…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6">
        {query.isLoading ? (
          <>
            <Spinner />
            <p className="text-[12px] text-muted">{t('กำลังโหลดแคตตาล็อก…', 'Loading catalog…')}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">{t('เปิดหน้าขายไม่ได้', 'Could not open the terminal')}</p>
            <p className="max-w-sm text-center text-[12px] text-muted">
              {errorMessage(query.error, locale)}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate('/dashboard')}>
                {t('กลับภาพรวม', 'Back to overview')}
              </Button>
              <Button variant="primary" onClick={() => void query.refetch()}>
                {t('ลองใหม่', 'Retry')}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  const shift = data.shift;
  const pendingCount = outbox.filter((item) => item.status !== 'synced').length;
  const categoryLabel = (name: string) => name;

  const cartPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold">{t('ตะกร้า', 'Cart')}</h2>
          <Badge tone={cart.length ? 'jade' : 'neutral'}>
            {number(cart.reduce((sum, line) => sum + line.qty, 0))} {t('ชิ้น', 'items')}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => void openHeld()} title={t('พักบิล', 'Held sales')}>
            <PauseCircle className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={resetCart}
            disabled={cart.length === 0}
            title={t('ล้างตะกร้า', 'Clear cart')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 transition-colors hover:bg-surface-2">
        <button type="button" onClick={() => setCustomerOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Users className="h-4 w-4 text-faint" />
          {customer ? (
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-text">{customer.name}</span>
              <span className="block text-[10px] text-faint">
                {customer.phone} · {customer.points ?? 0} {t('คะแนน', 'pts')}
              </span>
            </span>
          ) : (
            <span className="text-[12px] text-muted">{t('เลือกลูกค้า (ไม่บังคับ)', 'Add customer (optional)')}</span>
          )}
        </button>
        {customer ? (
          <button
            type="button"
            onClick={() => {
              setCustomer(null);
              setRedeemPoints(0);
            }}
            className="rounded p-1 text-faint hover:text-danger"
            aria-label={t('ลบลูกค้า', 'Remove customer')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Plus className="h-3.5 w-3.5 text-faint" />
        )}
      </div>

      {customer && data.business.loyaltyRedemptionEnabled && (customer.points ?? 0) > 0 ? (
        <div className="border-b border-line bg-jade-soft/25 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              {t('คะแนนสะสม', 'Points')}{' '}
              <span className="num font-medium text-jade">{customer.points}</span>
              {pointValue > 0 ? (
                <span className="text-faint"> · 1 = {money(pointValue)}</span>
              ) : null}
            </span>
            <button
              type="button"
              disabled={maxRedeemable <= 0}
              onClick={() => setRedeemPoints(pointsUsed > 0 ? 0 : maxRedeemable)}
              className="text-[11px] font-medium text-jade hover:underline disabled:text-faint disabled:no-underline"
            >
              {pointsUsed > 0 ? t('ยกเลิก', 'Clear') : t('ใช้คะแนน', 'Redeem')}
            </button>
          </div>
          {pointsUsed > 0 ? (
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={maxRedeemable}
                value={pointsUsed}
                onChange={(event) =>
                  setRedeemPoints(Math.max(0, Math.min(maxRedeemable, Number(event.target.value) || 0)))
                }
                className="h-8 w-20 text-right text-[12px]"
                aria-label={t('จำนวนคะแนนที่ใช้', 'Points to redeem')}
              />
              <button
                type="button"
                onClick={() => setRedeemPoints(maxRedeemable)}
                className="text-[10px] text-muted hover:text-text"
              >
                {t('สูงสุด', 'Max')}
              </button>
              <span className="num ml-auto text-[12px] font-medium text-jade">
                -{money(pointsDiscount)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-line-strong text-faint">
              <ScanBarcode className="h-5 w-5" />
            </span>
            <p className="text-[13px] font-medium">{t('ยังไม่มีสินค้าในตะกร้า', 'The cart is empty')}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
              {t('สแกนบาร์โค้ด หรือเลือกสินค้าจากด้านซ้าย', 'Scan a barcode or tap a product.')}
            </p>
            <p className="mt-3 rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] text-faint">
              F2 {t('ค้นหา', 'search')} · F4 {t('ชำระเงิน', 'pay')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {cart.map((line) => {
              const quoteLine = quote?.lines.find((l) => l.key === line.variantId);
              const discount = quoteLine?.discountSatang ?? 0;
              return (
                <div key={line.variantId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-line bg-surface-2">
                        {line.imageUrl ? (
                          <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[10px] text-faint">N</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-text">{line.name}</p>
                        <p className="mt-0.5 text-[10px] text-faint">{line.sku || '—'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCart((prev) => prev.filter((l) => l.variantId !== line.variantId))}
                      className="rounded p-1 text-faint hover:bg-danger-soft hover:text-danger"
                      aria-label={t('ลบ', 'Remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center rounded-md border border-line">
                      <button
                        type="button"
                        onClick={() => changeQty(line.variantId, -1)}
                        className="flex h-7 w-7 items-center justify-center text-muted hover:bg-surface-2"
                        aria-label={t('ลด', 'Decrease')}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="num w-8 text-center text-[12px] font-medium">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeQty(line.variantId, 1)}
                        className="flex h-7 w-7 items-center justify-center text-muted hover:bg-surface-2"
                        aria-label={t('เพิ่ม', 'Increase')}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDiscountTarget({ line: line.variantId })}
                        className={cn(
                          'rounded p-1 text-[10px]',
                          line.lineDiscount ? 'bg-amber-soft text-amber' : 'text-faint hover:bg-surface-2',
                        )}
                        title={t('ส่วนลดรายสินค้า', 'Line discount')}
                      >
                        <Percent className="h-3.5 w-3.5" />
                      </button>
                      <span className="num text-[13px] font-semibold">
                        {money(quoteLine?.totalSatang ?? line.unitPriceSatang * line.qty)}
                      </span>
                    </div>
                  </div>
                  {discount > 0 ? (
                    <p className="mt-1 text-right text-[10px] text-amber">
                      {t('ส่วนลด', 'Discount')} -{money(discount)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line bg-surface">
        <div className="space-y-1.5 px-4 py-3 text-[12px]">
          <div className="flex justify-between text-muted">
            <span>{t('ยอดรวมสินค้า', 'Subtotal')}</span>
            <span className="num text-text">{money(quote?.subtotalSatang ?? 0)}</span>
          </div>
          {(quote?.discountSatang ?? 0) > 0 ? (
            <div className="flex justify-between text-amber">              <button type="button" className="flex items-center gap-1 hover:underline" onClick={() => setDiscountTarget('order')}>
                {t('ส่วนลด', 'Discount')}
                <Percent className="h-3 w-3" />
              </button>
              <span className="num">-{money(quote?.discountSatang ?? 0)}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDiscountTarget('order')}
              className="flex items-center gap-1 text-[11px] text-jade hover:underline"
            >
              <Tag className="h-3 w-3" />
              {t('เพิ่มส่วนลดทั้งบิล', 'Add order discount')}
            </button>
          )}
          <div className="flex justify-between text-muted">
            <span>
              {t('ภาษีมูลค่าเพิ่ม', 'VAT')} {(data.business.vatRateBp / 100).toFixed(0)}%
              {data.business.pricesIncludeTax ? ` (${t('รวม', 'incl.')})` : ''}
            </span>
            <span className="num text-text">{money(quote?.taxSatang ?? 0)}</span>
          </div>
          {(quote?.appliedPromotions ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {(quote?.appliedPromotions ?? []).map((promo) => (
                <span key={promo.id} className="rounded bg-jade-soft px-1.5 py-0.5 text-[9.5px] text-jade">
                  {promo.name} -{money(promo.amountSatang)}
                </span>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setCouponOpen((v) => !v)}
            className="flex items-center gap-1 pt-1 text-[11px] text-muted hover:text-text"
          >
            <Tag className="h-3 w-3" />
            {couponCode ? `${t('คูปอง', 'Coupon')}: ${couponCode}` : t('ใช้คูปอง', 'Apply coupon')}
            {couponOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {couponOpen ? (
            <div className="flex gap-1.5 pb-1">
              <Input
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                placeholder="WELCOME50"
                className="h-8 text-[11.5px] uppercase"
              />
              <Button size="sm" variant="secondary" onClick={() => setCouponOpen(false)}>
                {t('ตกลง', 'Apply')}
              </Button>
            </div>
          ) : null}
          {quote?.ignoredCouponReason ? (
            <p className="text-[10px] text-amber">
              {quote.ignoredCouponReason === 'COUPON_NOT_STACKABLE'
                ? t('คูปองใช้ร่วมกับโปรโมชั่นนี้ไม่ได้', 'Coupon cannot stack with the active promotion.')
                : t('คูปองไม่เข้าเงื่อนไข', 'Coupon does not qualify.')}
            </p>
          ) : null}
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="flex items-end justify-between">
            <span className="text-[12px] text-muted">{t('ยอดสุทธิ', 'Total')}</span>
            <span className="num text-[28px] font-semibold leading-none tracking-tight">{money(total)}</span>
          </div>
          {!shift ? (
            <div className="mt-2 flex items-center justify-between rounded-md border border-amber/30 bg-amber-soft px-2 py-1.5 text-[10.5px] text-amber">
              <span className="flex items-center gap-1">
                <Wallet className="h-3 w-3" />
                {t('ยังไม่ได้เปิดกะ', 'No open shift')}
              </span>
              <button type="button" className="font-medium underline" onClick={() => setShiftOpen(true)}>
                {t('เปิดกะ', 'Open')}
              </button>
            </div>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            className="mt-3 w-full justify-between text-[15px]"
            disabled={cart.length === 0 || !quote}
            onClick={openCheckout}
          >
            <span className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              {offline ? t('บันทึกการขายออฟไลน์', 'Queue offline sale') : t('ชำระเงิน', 'Pay')}
            </span>
            <span className="num">{money(total)}</span>
          </Button>
          <div className="mt-2 flex justify-between">
            <Button size="sm" variant="ghost" onClick={() => void holdSale()} disabled={cart.length === 0}>
              <PauseCircle className="h-3.5 w-3.5" />
              {t('พักบิล', 'Hold')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void openHeld()}>
              <ReceiptText className="h-3.5 w-3.5" />
              {t('รายการพัก', 'Held')} ({data.heldSales.length})
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-text"
          title={t('กลับหน้าบริหาร', 'Back to admin')}
        >
          <LayoutDashboard className="h-4 w-4" />
          <span className="hidden text-[12px] font-medium sm:inline">NEXORA</span>
        </button>
        <div className="mx-1 h-6 w-px bg-line" />
        {me.stores.length > 1 ? (
          <label className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px]">
            <Store className="h-3.5 w-3.5 text-faint" />
            <select
              value={me.store?.id}
              onChange={(event) => setStore(event.target.value)}
              className="max-w-[112px] bg-transparent text-[12px] font-medium focus:outline-none sm:max-w-[150px]"
            >
              {me.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="flex items-center gap-1.5 text-[12px] font-medium">
            <Store className="h-3.5 w-3.5 text-faint" />
            {data.store.name}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShiftPanelOpen(true)}
          aria-label={shift ? t('กะเปิดอยู่', 'Shift open') : t('ยังไม่เปิดกะ', 'No shift')}
          className={cn(
            'ml-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px]',
            shift ? 'border-jade-border bg-jade-soft text-jade' : 'border-amber/30 bg-amber-soft text-amber',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          <span className="hidden sm:inline">{shift ? t('กะเปิดอยู่', 'Shift open') : t('ยังไม่เปิดกะ', 'No shift')}</span>
          {shift ? <span className="num hidden lg:inline">· {money(shift.expectedCashSatang, true)}</span> : null}
        </button>
        <div className="flex-1" />
        {offline ? (
          <Badge tone="amber" dot>
            {t('ออฟไลน์', 'Offline')}
          </Badge>
        ) : (
          <span className="hidden items-center gap-1 text-[10.5px] text-faint lg:flex">
            <Wifi className="h-3 w-3 text-jade" />
            {t('ออนไลน์', 'Online')}
          </span>
        )}
        <span className="num hidden text-[12px] text-muted xl:inline">
          {now.toLocaleTimeString(locale === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={toggleFullscreen}
          title={t('เต็มจอ', 'Fullscreen')}
          aria-label={t('เต็มจอ', 'Fullscreen')}
          className="hidden sm:inline-flex"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={openCustomerDisplay}
          title={t('เปิดจอลูกค้า', 'Open customer display')}
          aria-label={t('จอลูกค้า', 'Customer display')}
        >
          <MonitorUp className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSyncOpen(true)}>
          <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
          {pendingCount > 0 ? (
            <span className="rounded bg-amber px-1 text-[9px] text-white">{pendingCount}</span>
          ) : (
            <span className="hidden text-[10px] lg:inline">{t('ซิงก์', 'Sync')}</span>
          )}
        </Button>
        <div className="hidden items-center gap-1.5 border-l border-line pl-2 xl:flex">
          <span className="text-right text-[10.5px] leading-tight text-muted">
            {data.employee.displayName}
            <span className="block text-[9px] text-faint">{data.tenant.name}</span>
          </span>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={() => void logout().then(() => navigate('/login'))} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      {offline ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber/30 bg-amber-soft px-3 py-1.5 text-[11px] text-amber">
          <CloudOff className="h-3.5 w-3.5" />
          {data.offline.cashEnabled
            ? t(
                'โหมดออฟไลน์: รับเงินสดเท่านั้น รายการจะถูกเก็บในเครื่องและซิงก์เมื่อกลับมาออนไลน์',
                'Offline: cash only. Sales are queued on this device and synced when the network returns.',
              )
            : t('ร้านนี้ปิดการขายออฟไลน์', 'Offline sales are disabled for this store.')}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitSearch();
                    }
                  }}
                  placeholder={t('สแกนบาร์โค้ด หรือค้นหาชื่อ / SKU', 'Scan barcode or search name / SKU')}
                  className="h-11 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-20 text-[13px] outline-none transition-colors placeholder:text-faint focus:border-jade focus:bg-surface"
                  autoFocus
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9.5px] text-faint">
                  F2 · Enter
                </span>
              </div>
              <span className="hidden text-[10.5px] text-faint md:block">
                {filteredProducts.length} {t('รายการ', 'items')}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCategory(null)}
                className={cn(
                  'shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                  category === null
                    ? 'border-jade bg-jade-soft text-jade'
                    : 'border-line bg-surface text-muted hover:text-text',
                )}
              >
                {t('ทั้งหมด', 'All')}
              </button>
              {data.catalog.categories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  className={cn(
                    'shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                    category === item.id
                      ? 'border-jade bg-jade-soft text-jade'
                      : 'border-line bg-surface text-muted hover:text-text',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {categoryArt(item.name) ? (
                      <img src={categoryArt(item.name)} alt="" className="h-4 w-4 rounded object-cover" />
                    ) : null}
                    {categoryLabel(item.name)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {filteredProducts.length === 0 ? (
              <EmptyState
                icon={<Search className="h-5 w-5" />}
                title={t('ไม่พบสินค้า', 'No products found')}
                description={t('ลองค้นหาด้วยชื่อ SKU หรือบาร์โค้ดอื่น', 'Try another name, SKU or barcode.')}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filteredProducts.map((product) => {
                  const available = product.variants.reduce((sum, v) => sum + stockOf(v), 0);
                  const out = product.trackInventory && available <= 0;
                  const price = Math.min(...product.variants.map((v) => v.priceSatang));
                  const hasRange = new Set(product.variants.map((v) => v.priceSatang)).size > 1;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={out}
                      onClick={() => addProduct(product)}
                      className={cn(
                        'group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition-all',
                        out
                          ? 'cursor-not-allowed opacity-55'
                          : 'hover:-translate-y-0.5 hover:border-jade-border hover:shadow-md',
                      )}
                    >
                      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-2">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[28px] font-semibold tracking-tight text-muted/35">
                            {product.name.slice(0, 2)}
                          </span>
                        )}
                        <span
                          className={cn(
                            'absolute left-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-medium',
                            out
                              ? 'bg-danger text-white'
                              : product.trackInventory && available <= product.reorderPoint
                                ? 'bg-amber text-white'
                                : 'bg-surface/90 text-muted',
                          )}
                        >
                          {out
                            ? t('หมด', 'Out')
                            : product.trackInventory
                              ? `${number(available)} ${t('เหลือ', 'left')}`
                              : t('ไม่ติดสต๊อก', 'No stock')}
                        </span>
                        {product.variants.length > 1 ? (
                          <span className="absolute right-2 top-2 rounded bg-surface/90 px-1.5 py-0.5 text-[9px] text-muted">
                            {product.variants.length} {t('แบบ', 'opts')}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-1 flex-col p-2.5">
                        <p className="line-clamp-2 text-[12px] font-medium leading-snug text-text">{product.name}</p>
                        <div className="mt-auto flex items-end justify-between pt-2">
                          <span className="num text-[13.5px] font-semibold">
                            {hasRange ? `${t('เริ่ม', 'from')} ` : ''}
                            {money(price)}
                          </span>
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-jade-soft text-jade opacity-0 transition-opacity group-hover:opacity-100">
                            <Plus className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="hidden w-[400px] shrink-0 border-l border-line bg-surface lg:block">
          {cartPanel}
        </aside>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface p-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileCart(true)}
          className="flex flex-1 items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2"
        >
          <span className="flex items-center gap-2 text-[12px]">
            <ReceiptText className="h-4 w-4 text-jade" />
            {number(cart.reduce((sum, line) => sum + line.qty, 0))} {t('ชิ้น', 'items')}
          </span>
          <span className="num text-[15px] font-semibold">{money(total)}</span>
        </button>
        <Button variant="primary" size="lg" onClick={openCheckout} disabled={cart.length === 0}>
          {t('ชำระ', 'Pay')}
        </Button>
      </div>

      {/* Variant picker */}
      <Modal
        open={Boolean(variantPicker)}
        onClose={() => setVariantPicker(null)}
        title={variantPicker?.name}
        description={t('เลือกตัวเลือกสินค้า', 'Choose a variant')}
        size="sm"
      >
        <div className="space-y-1.5">
          {variantPicker?.variants.map((variant) => {
            const available = stockOf(variant);
            const out = variant.trackInventory && available <= 0;
            return (
              <button
                key={variant.id}
                type="button"
                disabled={out}
                onClick={() => {
                  addVariant(variantPicker, variant);
                  setVariantPicker(null);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-jade-border hover:bg-jade-soft/40 disabled:opacity-50"
              >
                <span>
                  <span className="block text-[13px] font-medium">{variant.name}</span>
                  <span className="block text-[10.5px] text-faint">
                    {variant.sku} · {t('เหลือ', 'stock')} {number(available)}
                  </span>
                </span>
                <span className="num text-[13px] font-semibold">{money(variant.priceSatang)}</span>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Customer */}
      <CustomerModal
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        selected={customer}
        onSelect={(value) => {
          setCustomer(value);
          setRedeemPoints(0);
          setCustomerOpen(false);
        }}
      />

      {/* Held */}
      <Modal
        open={heldOpen}
        onClose={() => setHeldOpen(false)}
        title={t('รายการพักบิล', 'Held sales')}
        description={t('เรียกคืนตะกร้าที่พักไว้', 'Resume a parked cart')}
        size="md"
      >
        {data.heldSales.length === 0 ? (
          <EmptyState
            icon={<PauseCircle className="h-5 w-5" />}
            title={t('ไม่มีรายการพัก', 'Nothing on hold')}
            description={t('กดพักบิลเพื่อเก็บตะกร้าไว้ชั่วคราว', 'Use Hold to park the current cart.')}
          />
        ) : (
          <div className="space-y-2">
            {data.heldSales.map((held) => (
              <div key={held.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => retrieveHeld(held)}>
                  <p className="truncate text-[12.5px] font-medium">{held.label || t('พักบิล', 'Held sale')}</p>
                  <p className="text-[10.5px] text-faint">{dateTime(held.createdAt)}</p>
                </button>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => retrieveHeld(held)}>
                    {t('เรียกคืน', 'Resume')}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={async () => {
                      await api(`/pos/held/${held.id}`, { method: 'DELETE' });
                      await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
                    }}
                    aria-label={t('ลบ', 'Delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Discount */}
      <DiscountModal
        open={Boolean(discountTarget)}
        target={discountTarget}
        current={
          discountTarget === 'order'
            ? orderDiscount
            : discountTarget
              ? cart.find((line) => line.variantId === discountTarget.line)?.lineDiscount ?? null
              : null
        }
        onClose={() => setDiscountTarget(null)}
        onApply={(discount) => {
          if (discountTarget === 'order') setOrderDiscount(discount);
          else if (discountTarget) {
            setCart((prev) =>
              prev.map((line) =>
                line.variantId === discountTarget.line ? { ...line, lineDiscount: discount } : line,
              ),
            );
          }
          setDiscountTarget(null);
        }}
        lineTotal={
          discountTarget && discountTarget !== 'order'
            ? (quote?.lines.find((l) => l.key === discountTarget.line)?.grossSatang ?? 0)
            : undefined
        }
      />

      {/* Shift open */}
      <ShiftOpenModal
        open={shiftOpen}
        onClose={() => setShiftOpen(false)}
        canOpen={data.permissions.includes('shifts.open')}
        onOpened={async () => {
          setShiftOpen(false);
          autoShiftPrompted.current = true;
          await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
          toast.success(t('เปิดกะแล้ว', 'Shift opened'));
        }}
      />

      {/* Shift panel */}
      <ShiftPanel
        open={shiftPanelOpen}
        onClose={() => setShiftPanelOpen(false)}
        shift={shift}
        onOpenShift={() => {
          setShiftPanelOpen(false);
          setShiftOpen(true);
        }}
        onCash={(type) => {
          setShiftPanelOpen(false);
          setCashModal(type);
        }}
        onClosed={async () => {
          setShiftPanelOpen(false);
          await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
          toast.success(t('ปิดกะแล้ว', 'Shift closed'));
        }}
      />

      <CashModal
        open={cashModal !== null}
        type={cashModal}
        onClose={() => setCashModal(null)}
        onDone={async () => {
          setCashModal(null);
          await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
          toast.success(t('บันทึกเงินสดแล้ว', 'Cash movement recorded'));
        }}
      />

      {/* Checkout */}
      <Modal
        open={checkoutOpen}
        onClose={() => {
          setCheckoutOpen(false);
          setOperationId(null);
        }}
        title={t('ชำระเงิน', 'Take payment')}
        description={`${cart.reduce((sum, line) => sum + line.qty, 0)} ${t('ชิ้น', 'items')} · ${data.store.name}`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckoutOpen(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={!paymentValid}
              onClick={() => void submitCheckout()}
              className="min-w-[180px]"
            >
              {offline ? t('บันทึกออฟไลน์', 'Queue sale') : t('ยืนยันการชำระเงิน', 'Confirm payment')}
            </Button>
          </>
        }
      >
        {quote ? (
          <div className="grid gap-4 md:grid-cols-[1fr_240px]">
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">
                  {t('วิธีชำระเงิน', 'Payment method')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods.map((method) => {
                    const active = payments.some((row) => row.method === method.code);
                    const Icon =
                      method.type === 'cash'
                        ? Banknote
                        : method.type === 'card'
                          ? CreditCard
                          : method.type === 'qr'
                            ? QrCode
                            : Wallet;
                    return (
                      <button
                        key={method.code}
                        type="button"
                        disabled={offline && method.type !== 'cash'}
                        onClick={() => {
                          setPayments((prev) => {
                            const first = prev[0];
                            if (!first) return prev;
                            return [
                              {
                                ...first,
                                method: method.code,
                                tenderedSatang: method.type === 'cash' ? first.amountSatang : first.amountSatang,
                                reference: '',
                              },
                              ...prev.slice(1),
                            ];
                          });
                        }}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[12px] font-medium transition-colors',
                          active
                            ? 'border-jade bg-jade-soft text-jade'
                            : 'border-line bg-surface text-muted hover:border-line-strong',
                          offline && method.type !== 'cash' && 'cursor-not-allowed opacity-40',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {method.name}
                      </button>
                    );
                  })}
                </div>
                {offline ? (
                  <p className="mt-2 text-[10.5px] text-amber">
                    {t('โหมดออฟไลน์รับเฉพาะเงินสด', 'Offline mode accepts cash only.')}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                {payments.map((row) => {
                  const method = paymentMethods.find((m) => m.code === row.method);
                  const isCash = method?.type === 'cash';
                  return (
                    <div key={row.key} className="rounded-lg border border-line bg-surface-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-1 items-center gap-2">
                          <Select
                            value={row.method}
                            onChange={(event) => {
                              const next = paymentMethods.find((m) => m.code === event.target.value);
                              setPayments((prev) =>
                                prev.map((p) =>
                                  p.key === row.key
                                    ? {
                                        ...p,
                                        method: event.target.value,
                                        reference: '',
                                        tenderedSatang: next?.type === 'cash' ? p.amountSatang : p.amountSatang,
                                      }
                                    : p,
                                ),
                              );
                            }}
                            className="h-9 flex-1 text-[12px]"
                          >
                            {paymentMethods.map((m) => (
                              <option key={m.code} value={m.code} disabled={offline && m.type !== 'cash'}>
                                {m.name}
                              </option>
                            ))}
                          </Select>
                          {payments.length > 1 ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setPayments((prev) => prev.filter((p) => p.key !== row.key))}
                              aria-label={t('ลบช่องทาง', 'Remove')}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                        <div className="w-28">
                          <MoneyInput
                            value={row.amountSatang}
                            onChange={(value) =>
                              setPayments((prev) =>
                                prev.map((p) =>
                                  p.key === row.key
                                    ? {
                                        ...p,
                                        amountSatang: value,
                                        tenderedSatang:
                                          method?.type === 'cash' && p.tenderedSatang < value
                                            ? value
                                            : p.tenderedSatang,
                                      }
                                    : p,
                                ),
                              )
                            }
                            className="h-9 text-right text-[12px]"
                            aria-label={t('จำนวนเงิน', 'Amount')}
                          />
                        </div>
                      </div>
                      {isCash ? (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Field label={t('รับเงินมา', 'Cash received')}>
                            <MoneyInput
                              value={row.tenderedSatang}
                              onChange={(value) =>
                                setPayments((prev) =>
                                  prev.map((p) => (p.key === row.key ? { ...p, tenderedSatang: value } : p)),
                                )
                              }
                              className="h-9 text-right text-[12px]"
                            />
                          </Field>
                          <div className="flex flex-col justify-end">
                            <p className="text-[10px] text-faint">{t('เงินทอน', 'Change')}</p>
                            <p className="num text-[16px] font-semibold text-jade">
                              {money(Math.max(0, row.tenderedSatang - row.amountSatang))}
                            </p>
                          </div>
                          <div className="col-span-2 flex flex-wrap gap-1">
                            {[row.amountSatang, 10000, 20000, 50000, 100000].map((amount, i) => (
                              <button
                                key={`${amount}-${i}`}
                                type="button"
                                onClick={() =>
                                  setPayments((prev) =>
                                    prev.map((p) =>
                                      p.key === row.key
                                        ? { ...p, tenderedSatang: Math.max(amount, p.amountSatang) }
                                        : p,
                                    ),
                                  )
                                }
                                className="rounded border border-line bg-surface px-2 py-1 text-[10.5px] text-muted hover:border-jade-border hover:text-text"
                              >
                                {i === 0 ? t('พอดี', 'Exact') : money(amount)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <Field label={t('เลขอ้างอิงการชำระ', 'Payment reference')} required>
                            <Input
                              value={row.reference}
                              onChange={(event) =>
                                setPayments((prev) =>
                                  prev.map((p) => (p.key === row.key ? { ...p, reference: event.target.value } : p)),
                                )
                              }
                              placeholder={t('เลขอนุมัติ / เลขสลิป', 'Approval or slip reference')}
                              className="h-9 text-[12px]"
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!offline ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      const remaining = Math.max(0, (quote?.totalSatang ?? 0) - appliedTotal);
                      const method = paymentMethods.find((m) => m.type !== 'cash') ?? defaultMethod;
                      if (!method) return;
                      setPayments((prev) => [
                        ...prev,
                        {
                          key: uuidv7(),
                          method: method.code,
                          amountSatang: remaining,
                          tenderedSatang: remaining,
                          reference: '',
                        },
                      ]);
                    }}
                  >
                    {t('แบ่งชำระ / เพิ่มช่องทาง', 'Split payment')}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">
                {t('สรุปยอด', 'Summary')}
              </p>
              <div className="mt-2 space-y-1 text-[11.5px]">
                <div className="flex justify-between text-muted">
                  <span>{t('ยอดสินค้า', 'Items')}</span>
                  <span className="num">{money(quote.subtotalSatang)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>{t('ส่วนลด', 'Discount')}</span>
                  <span className="num">{quote.discountSatang > 0 ? `-${money(quote.discountSatang)}` : money(0)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>{t('ภาษี', 'VAT')}</span>
                  <span className="num">{money(quote.taxSatang)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-[16px] font-semibold">
                  <span>{t('รวม', 'Total')}</span>
                  <span className="num">{money(quote.totalSatang)}</span>
                </div>
                <div className="flex justify-between pt-1 text-[11.5px]">
                  <span className="text-muted">{t('รับแล้ว', 'Applied')}</span>
                  <span className={cn('num', appliedTotal === quote.totalSatang ? 'text-jade' : 'text-amber')}>
                    {money(appliedTotal)}
                  </span>
                </div>
                {appliedTotal !== quote.totalSatang ? (
                  <p className="text-[10.5px] text-amber">
                    {t('เหลืออีก', 'Remaining')} {money(quote.totalSatang - appliedTotal)}
                  </p>
                ) : null}
                {changeTotal > 0 ? (
                  <div className="mt-2 rounded-lg bg-jade-soft p-2 text-center">
                    <p className="text-[10px] text-jade">{t('เงินทอน', 'Change due')}</p>
                    <p className="num text-[18px] font-semibold text-jade">{money(changeTotal)}</p>
                  </div>
                ) : null}
              </div>
              {customer ? (
                <p className="mt-3 border-t border-line pt-2 text-[10.5px] text-muted">
                  {t('ลูกค้า', 'Customer')}: <span className="text-text">{customer.name}</span>
                  <br />
                  {t('จะได้รับ', 'Earns')} {Math.floor(quote.totalSatang / 10_000) * data.business.loyaltyEarnPerBaht}{' '}
                  {t('คะแนน', 'points')}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Success */}
      <Modal
        open={Boolean(success)}
        onClose={() => setSuccess(null)}
        size="md"
        title={success?.status === 'pending_sync' ? t('บันทึกออฟไลน์แล้ว', 'Queued offline') : t('ชำระเงินสำเร็จ', 'Payment complete')}
        description={success?.number}
        footer={
          <>
            <Button variant="secondary" onClick={() => success && printReceipt(success.receipt)} leftIcon={<Printer className="h-4 w-4" />}>
              {t('พิมพ์ใบเสร็จ', 'Print receipt')}
            </Button>
            <Button variant="primary" onClick={() => setSuccess(null)} rightIcon={<ArrowRight className="h-4 w-4" />}>
              {t('บิลใหม่', 'New sale')}
            </Button>
          </>
        }
      >
        {success ? (
          <div>
            <div className="mb-4 text-center">
              <CircleCheck className="mx-auto h-10 w-10 text-jade" />
              <p className="num mt-2 text-[28px] font-semibold">{money(success.totalSatang)}</p>
              {success.changeSatang > 0 ? (
                <p className="mt-1 text-[12px] text-muted">
                  {t('เงินทอน', 'Change')}{' '}
                  <span className="num font-semibold text-text">{money(success.changeSatang)}</span>
                </p>
              ) : null}
              {success.loyaltyPoints > 0 ? (
                <p className="mt-1 text-[11px] text-jade">
                  +{success.loyaltyPoints} {t('คะแนนสะสม', 'loyalty points')}
                </p>
              ) : null}
              {success.pointsRedeemed && success.pointsRedeemed > 0 ? (
                <p className="mt-1 text-[11px] text-amber">
                  {t('ใช้', 'Used')} {success.pointsRedeemed} {t('คะแนน', 'points')} · -
                  {money(success.pointsDiscountSatang ?? 0)}
                </p>
              ) : null}
              {success.customerPointsBalance != null ? (
                <p className="mt-0.5 text-[10px] text-faint">
                  {t('คงเหลือ', 'Balance')} {success.customerPointsBalance} {t('คะแนน', 'points')}
                </p>
              ) : null}
              {success.warnings.includes('OFFLINE_QUEUED') ? (
                <div className="mx-auto mt-3 max-w-sm">
                  <InlineAlert tone="warning">
                    {t(
                      'รายการนี้ถูกเก็บในเครื่องและจะซิงก์เมื่อออนไลน์ เลขที่บิลจริงจะออกจากเซิร์ฟเวอร์',
                      'This sale is stored on the device. The official receipt number is issued by the server when it syncs.',
                    )}
                  </InlineAlert>
                </div>
              ) : null}
            </div>
            <ReceiptView receipt={success.receipt} onPrint={() => printReceipt(success.receipt)} />
          </div>
        ) : null}
      </Modal>

      {/* Mobile cart */}
      <Drawer open={mobileCart} onClose={() => setMobileCart(false)} width="md" title={t('ตะกร้า', 'Cart')}>
        {cartPanel}
      </Drawer>

      {/* Sync */}
      <Modal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        title={t('คิวซิงก์ออฟไลน์', 'Offline sync queue')}
        description={t('รายการที่ขายบนเครื่องนี้', 'Sales created on this device')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={async () => { await clearSynced(); await refreshOutbox(); }}>
              {t('ล้างรายการที่ซิงก์แล้ว', 'Clear synced')}
            </Button>
            <Button variant="primary" loading={syncing} onClick={() => void syncOutbox()} leftIcon={<RefreshCw className="h-4 w-4" />}>
              {t('ซิงก์ตอนนี้', 'Sync now')}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          {online ? (
            <Badge tone="jade" dot>{t('ออนไลน์', 'Online')}</Badge>
          ) : (
            <Badge tone="amber" dot>{t('ออฟไลน์', 'Offline')}</Badge>
          )}
          <span className="text-[11px] text-muted">
            {outbox.filter((i) => i.status !== 'synced').length} {t('รายการรอซิงก์', 'pending')}
          </span>
        </div>
        {outbox.length === 0 ? (
          <EmptyState
            icon={<RefreshCw className="h-5 w-5" />}
            title={t('ไม่มีรายการค้าง', 'Queue is empty')}
            description={t('การขายออนไลน์ไม่ต้องใช้คิวนี้', 'Online sales do not use this queue.')}
          />
        ) : (
          <div className="space-y-2">
            {outbox.map((item) => (
              <div key={item.operationId} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="num text-[12px] font-medium">{item.saleNumber ?? item.operationId.slice(0, 8)}</p>
                  <Badge tone={item.status === 'synced' ? 'jade' : item.status === 'failed' ? 'danger' : 'amber'}>
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-1 text-[10.5px] text-faint">
                  {dateTime(item.queuedAt)} · {t('พยายาม', 'attempts')} {item.attempts}
                </p>
                {item.error ? <p className="mt-1 text-[10.5px] text-danger">{item.error}</p> : null}
                {item.status === 'synced' && item.receipt ? (
                  <button
                    type="button"
                    className="mt-2 text-[10.5px] text-jade hover:underline"
                    onClick={() => printReceipt(item.receipt as ReceiptSnapshot)}
                  >
                    {t('พิมพ์ใบเสร็จ', 'Print receipt')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {lastSale && !success ? (
        <button
          type="button"
          onClick={() => setSuccess(lastSale)}
          className="fixed bottom-16 right-4 z-20 hidden rounded-full border border-line bg-surface px-3 py-2 text-[11px] elevated lg:flex"
        >
          <ReceiptText className="mr-1.5 h-3.5 w-3.5 text-jade" />
          {t('บิลล่าสุด', 'Last receipt')} {lastSale.number}
        </button>
      ) : null}
    </div>
  );
}

function CustomerModal({
  open,
  onClose,
  selected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  selected: CustomerLite | null;
  onSelect: (customer: CustomerLite) => void;
}) {
  const { t, locale } = useLang();
  const { money } = useFormat();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const query = useQuery({
    queryKey: ['customers', 'pos', search],
    queryFn: () =>
      api<Array<CustomerLite & { totalSpentSatang: number }>>(
        `/customers?pageSize=20&search=${encodeURIComponent(search)}`,
        { storeId: null },
      ),
    enabled: open,
  });

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await api<CustomerLite>('/customers', {
        method: 'POST',
        body: { name, phone, consentMarketing: false },
      });
      onSelect({ ...result.data, points: 0 });
      setName('');
      setPhone('');
      toast.success(t('เพิ่มลูกค้าแล้ว', 'Customer added'));
    } catch (error) {
      toast.error(t('เพิ่มลูกค้าไม่สำเร็จ', 'Could not add customer'), errorMessage(error, locale));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('เลือกลูกค้า', 'Select customer')} size="md">
      <div className="space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder={t('ค้นหาชื่อหรือเบอร์โทร', 'Search name or phone')} />
        {query.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {(query.data?.data ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors',
                  selected?.id === item.id ? 'border-jade bg-jade-soft' : 'border-line hover:bg-surface-2',
                )}
              >
                <span>
                  <span className="block text-[12.5px] font-medium">{item.name}</span>
                  <span className="block text-[10.5px] text-faint">
                    {item.phone ?? '—'} · {item.tier} · {money(item.totalSpentSatang ?? 0)}
                  </span>
                </span>
                {item.points !== undefined ? (
                  <span className="num text-[11px] text-jade">{item.points} pts</span>
                ) : null}
              </button>
            ))}
            {(query.data?.data ?? []).length === 0 ? (
              <p className="py-4 text-center text-[11.5px] text-faint">{t('ไม่พบลูกค้า', 'No customer found')}</p>
            ) : null}
          </div>
        )}
        <div className="rounded-lg border border-dashed border-line p-3">
          <p className="mb-2 flex items-center gap-1 text-[11px] font-medium">
            <UserPlus className="h-3.5 w-3.5 text-jade" />
            {t('เพิ่มลูกค้าใหม่', 'New customer')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('ชื่อ', 'Name')} className="h-9 text-[12px]" />
            <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t('เบอร์โทร', 'Phone')} className="h-9 text-[12px]" />
          </div>
          <Button size="sm" variant="secondary" className="mt-2" loading={creating} onClick={() => void create()}>
            {t('บันทึกลูกค้า', 'Save customer')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DiscountModal({
  open,
  target,
  current,
  lineTotal,
  onClose,
  onApply,
}: {
  open: boolean;
  target: 'order' | { line: string } | null;
  current: Discount | null;
  lineTotal?: number;
  onClose: () => void;
  onApply: (discount: Discount | null) => void;
}) {
  const { t } = useLang();
  const { money } = useFormat();
  const [type, setType] = useState<'percent' | 'amount'>('percent');
  const [percent, setPercent] = useState('10');
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (current?.type === 'percent') {
      setType('percent');
      setPercent(String(current.basisPoints / 100));
    } else if (current?.type === 'amount') {
      setType('amount');
      setAmount(current.satang);
    } else {
      setType('percent');
      setPercent('10');
      setAmount(0);
    }
  }, [open, current]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={target === 'order' ? t('ส่วนลดทั้งบิล', 'Order discount') : t('ส่วนลดรายสินค้า', 'Line discount')}
      size="sm"
      footer={
        <>
          {current ? (
            <Button variant="ghost" onClick={() => onApply(null)}>
              {t('ลบส่วนลด', 'Remove')}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => {
            if (type === 'percent') {
              const value = Number(percent);
              if (!Number.isFinite(value) || value <= 0 || value > 100) return;
              onApply({ type: 'percent', basisPoints: Math.round(value * 100) });
            } else {
              if (amount <= 0) return;
              onApply({ type: 'amount', satang: amount });
            }
          }}>
            {t('ใช้ส่วนลด', 'Apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('percent')}
            className={cn(
              'rounded-lg border px-3 py-2 text-[12px] font-medium',
              type === 'percent' ? 'border-jade bg-jade-soft text-jade' : 'border-line text-muted',
            )}
          >
            {t('เปอร์เซ็นต์', 'Percentage')}
          </button>
          <button
            type="button"
            onClick={() => setType('amount')}
            className={cn(
              'rounded-lg border px-3 py-2 text-[12px] font-medium',
              type === 'amount' ? 'border-jade bg-jade-soft text-jade' : 'border-line text-muted',
            )}
          >
            {t('จำนวนเงิน', 'Amount')}
          </button>
        </div>
        {type === 'percent' ? (
          <Field label={t('เปอร์เซ็นต์ส่วนลด', 'Discount percent')}>
            <Input type="number" min="0" max="100" step="0.01" value={percent} onChange={(event) => setPercent(event.target.value)} />
          </Field>
        ) : (
          <Field label={t('จำนวนเงิน (บาท)', 'Amount (THB)')}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
        )}
        {lineTotal !== undefined ? (
          <p className="text-[11px] text-faint">
            {t('ยอดก่อนส่วนลด', 'Line gross')} {money(lineTotal)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ShiftOpenModal({
  open,
  onClose,
  canOpen,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  canOpen: boolean;
  onOpened: () => Promise<void>;
}) {
  const { t, locale } = useLang();
  const { money } = useFormat();
  const toast = useToast();
  const [cash, setCash] = useState(200_000);
  const [terminal, setTerminal] = useState('Counter 1');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      await api('/shifts/open', {
        method: 'POST',
        body: { openingCashSatang: cash, terminalName: terminal },
      });
      await onOpened();
    } catch (error) {
      toast.error(t('เปิดกะไม่สำเร็จ', 'Could not open shift'), errorMessage(error, locale));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('เปิดกะ', 'Open shift')}
      description={t('นับเงินสดเริ่มต้นก่อนเริ่มขาย', 'Count the opening float before selling.')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ไว้ก่อน', 'Later')}
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()} disabled={!canOpen}>
            {t('เปิดกะ', 'Open shift')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!canOpen ? <InlineAlert tone="warning">{t('คุณไม่มีสิทธิ์เปิดกะ', 'You do not have permission to open a shift.')}</InlineAlert> : null}
        <Field label={t('เงินสดเริ่มต้น', 'Opening cash')} hint={t('ใส่จำนวนเงินสดที่มีในลิ้นชัก', 'Cash physically in the drawer.')}>
          <MoneyInput value={cash} onChange={setCash} data-autofocus />
        </Field>
        <Field label={t('ชื่อเครื่อง / จุดขาย', 'Terminal name')}>
          <Input value={terminal} onChange={(event) => setTerminal(event.target.value)} />
        </Field>
        <p className="rounded-lg bg-surface-2 p-2 text-[11px] text-muted">
          {t('ยอดขายเงินสดจะถูกเพิ่มเข้าเงินในลิ้นชักอัตโนมัติ', 'Cash sales are added to the expected drawer automatically.')} ·{' '}
          {money(cash)}
        </p>
      </div>
    </Modal>
  );
}

function ShiftPanel({
  open,
  onClose,
  shift,
  onOpenShift,
  onCash,
  onClosed,
}: {
  open: boolean;
  onClose: () => void;
  shift: ShiftSummary | null;
  onOpenShift: () => void;
  onCash: (type: 'cash_in' | 'cash_out') => void;
  onClosed: () => Promise<void>;
}) {
  const { t, locale } = useLang();
  const { money } = useFormat();
  const toast = useToast();
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (shift) setCounted(shift.expectedCashSatang);
  }, [shift]);

  if (!shift) {
    return (
      <Modal open={open} onClose={onClose} title={t('กะและเงินสด', 'Shift & cash')} size="sm">
        <EmptyState
          icon={<Wallet className="h-5 w-5" />}
          title={t('ยังไม่มีกะที่เปิด', 'No open shift')}
          description={t('เปิดกะเพื่อเริ่มรับชำระเงิน', 'Open a shift before taking payments.')}
          action={
            <Button variant="primary" onClick={onOpenShift}>
              {t('เปิดกะ', 'Open shift')}
            </Button>
          }
        />
      </Modal>
    );
  }

  const close = async () => {
    setLoading(true);
    try {
      await api('/shifts/close', { method: 'POST', body: { countedCashSatang: counted, note } });
      await onClosed();
    } catch (error) {
      toast.error(t('ปิดกะไม่สำเร็จ', 'Could not close shift'), errorMessage(error, locale));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('กะปัจจุบัน', 'Current shift')}
      description={`${t('เปิดเมื่อ', 'Opened')} ${new Date(shift.shift.opened_at).toLocaleString(locale === 'th' ? 'th-TH' : 'en-GB')}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ปิด', 'Close')}
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void close()}>
            {t('ปิดกะ', 'Close shift')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line p-3">
            <p className="text-[10px] text-faint">{t('ยอดขายในกะ', 'Shift sales')}</p>
            <p className="num text-[16px] font-semibold">{money(shift.salesTotalSatang)}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-[10px] text-faint">{t('เงินสดที่ควรมี', 'Expected cash')}</p>
            <p className="num text-[16px] font-semibold">{money(shift.expectedCashSatang)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => onCash('cash_in')}>
            {t('รับเงินสดเข้า', 'Cash in')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onCash('cash_out')}>
            {t('จ่ายเงินสดออก', 'Cash out')}
          </Button>
        </div>
        <Field
          label={t('เงินสดนับได้', 'Counted cash')}
          hint={`${t('ส่วนต่าง', 'Variance')} ${money(counted - shift.expectedCashSatang)}`}
        >
          <MoneyInput value={counted} onChange={setCounted} />
        </Field>
        <Field label={t('หมายเหตุ', 'Note')}>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder={t('ถ้ามีส่วนต่าง อธิบายสั้น ๆ', 'Explain any variance')} />
        </Field>
        <p className="text-[10.5px] text-faint">
          {t('การปิดกะจะบันทึกยอดคาดหวังและส่วนต่างไว้ตรวจสอบย้อนหลัง', 'Closing records expected cash and the variance for audit.')}
        </p>
      </div>
    </Modal>
  );
}

function CashModal({
  open,
  type,
  onClose,
  onDone,
}: {
  open: boolean;
  type: 'cash_in' | 'cash_out' | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, locale } = useLang();
  const toast = useToast();
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!type || amount <= 0 || reason.trim().length < 2) return;
    setLoading(true);
    try {
      await api('/shifts/cash-movements', {
        method: 'POST',
        body: { operationId: uuidv7(), type, amountSatang: amount, reason },
      });
      setAmount(0);
      setReason('');
      await onDone();
    } catch (error) {
      toast.error(t('บันทึกเงินสดไม่สำเร็จ', 'Cash movement failed'), errorMessage(error, locale));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={type === 'cash_in' ? t('รับเงินสดเข้า', 'Cash in') : t('จ่ายเงินสดออก', 'Cash out')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ยกเลิก', 'Cancel')}
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()} disabled={amount <= 0 || reason.trim().length < 2}>
            {t('บันทึก', 'Record')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('จำนวนเงิน', 'Amount')} required>
          <MoneyInput value={amount} onChange={setAmount} data-autofocus />
        </Field>
        <Field label={t('เหตุผล', 'Reason')} required>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('เช่น แลกเงิน, ซื้อของใช้ร้าน', 'e.g. change, store supplies')} />
        </Field>
      </div>
    </Modal>
  );
}
