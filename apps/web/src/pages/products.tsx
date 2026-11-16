import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Download,
  FolderPlus,
  Package,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { downloadFile } from '../lib/download';
import { CATEGORY_ART } from '../lib/art';
import { PageBody, PageHeader } from '../components/shell';
import { MoneyInput } from '../components/money-input';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  Switch,
  Table,
  TD,
  Textarea,
  TH,
  TR,
  cn,
  useToast,
} from '../components/ui';

interface Variant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceSatang: number;
  costSatang: number;
  compareAtSatang: number | null;
  attributes: Record<string, string>;
  isDefault: boolean;
  onHand: number;
}

interface Product {
  id: string;
  name: string;
  description: string;
  status: string;
  type: 'simple' | 'variable';
  imageUrl: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  unitId: string | null;
  unitCode: string | null;
  taxRateBp: number | null;
  trackInventory: boolean;
  reorderPoint: number;
  minPriceSatang: number;
  maxPriceSatang: number;
  onHand: number;
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: string;
  name: string;
  productCount?: number;
}

interface VariantDraft {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  priceSatang: number;
  costSatang: number;
  isDefault: boolean;
}

interface ProductDraft {
  name: string;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  brandId: string;
  unitId: string;
  imageUrl: string;
  type: 'simple' | 'variable';
  costSatang: number;
  priceSatang: number;
  compareAtSatang: number;
  trackInventory: boolean;
  reorderPoint: number;
  status: string;
  variants: VariantDraft[];
}

const emptyDraft: ProductDraft = {
  name: '',
  sku: '',
  barcode: '',
  description: '',
  categoryId: '',
  brandId: '',
  unitId: '',
  imageUrl: '',
  type: 'simple',
  costSatang: 0,
  priceSatang: 0,
  compareAtSatang: 0,
  trackInventory: true,
  reorderPoint: 5,
  status: 'active',
  variants: [],
};

export function ProductsPage() {
  const { t, locale } = useLang();
  const { money, number } = useFormat();
  const { can, storeId } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const products = useQuery({
    queryKey: ['products', page, search, categoryId, status, storeId],
    queryFn: () =>
      api<Product[]>(
        `/products${qs({
          page,
          pageSize: 20,
          search: search || undefined,
          categoryId: categoryId || undefined,
          status: status || undefined,
          includeInactive: true,
        })}`,
      ),
    enabled: can('products.read'),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
    enabled: can('products.read'),
  });

  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/brands'),
    enabled: can('products.read'),
  });

  const units = useQuery({
    queryKey: ['units'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/units'),
    enabled: can('products.read'),
  });

  const rows = products.data?.data ?? [];
  const meta = products.data?.meta;

  const openCreate = () => {
    setEditing(null);
    setDraft({
      ...emptyDraft,
      categoryId: categories.data?.data[0]?.id ?? '',
      unitId: units.data?.data[0]?.id ?? '',
    });
    setFormOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1' && can('products.create')) {
      openCreate();
      window.history.replaceState(null, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (product: Product) => {
    setEditing(product);
    const primary = product.variants.find((v) => v.isDefault) ?? product.variants[0];
    setDraft({
      name: product.name,
      sku: primary?.sku ?? '',
      barcode: primary?.barcode ?? '',
      description: product.description,
      categoryId: product.categoryId ?? '',
      brandId: product.brandId ?? '',
      unitId: product.unitId ?? '',
      imageUrl: product.imageUrl,
      type: product.type,
      costSatang: primary?.costSatang ?? 0,
      priceSatang: primary?.priceSatang ?? 0,
      compareAtSatang: primary?.compareAtSatang ?? 0,
      trackInventory: product.trackInventory,
      reorderPoint: product.reorderPoint,
      status: product.status,
      variants: product.variants.map((variant, index) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku ?? '',
        barcode: variant.barcode ?? '',
        priceSatang: variant.priceSatang,
        costSatang: variant.costSatang,
        isDefault: variant.isDefault || index === 0,
      })),
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    const payload = {
      name: draft.name,
      sku: draft.sku || '',
      barcode: draft.barcode || '',
      description: draft.description || '',
      categoryId: draft.categoryId || null,
      brandId: draft.brandId || null,
      unitId: draft.unitId || null,
      imageUrl: draft.imageUrl || '',
      type: draft.type,
      costSatang: draft.costSatang,
      priceSatang: draft.priceSatang,
      compareAtSatang: draft.compareAtSatang || undefined,
      trackInventory: draft.trackInventory,
      reorderPoint: draft.reorderPoint,
      status: draft.status,
      variants:
        draft.type === 'variable'
          ? draft.variants.map((variant, index) => ({
              id: variant.id,
              name: variant.name || `ตัวเลือก ${index + 1}`,
              sku: variant.sku || '',
              barcode: variant.barcode || '',
              priceSatang: variant.priceSatang,
              costSatang: variant.costSatang,
              isDefault: variant.isDefault || index === 0,
            }))
          : undefined,
    };
    try {
      if (editing) await api(`/products/${editing.id}`, { method: 'PUT', body: payload });
      else await api('/products', { method: 'POST', body: payload });
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(editing ? t('แก้ไขสินค้าแล้ว', 'Product updated') : t('เพิ่มสินค้าแล้ว', 'Product created'));
    } catch (error) {
      toast.error(t('บันทึกสินค้าไม่สำเร็จ', 'Could not save product'), errorMessage(error, locale));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!archiveTarget) return;
    try {
      await api(`/products/${archiveTarget.id}/archive`, { method: 'POST', body: {} });
      setArchiveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(t('เก็บสินค้าแล้ว', 'Product archived'));
    } catch (error) {
      toast.error(t('เก็บสินค้าไม่สำเร็จ', 'Archive failed'), errorMessage(error, locale));
    }
  };

  const createCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      await api('/categories', { method: 'POST', body: { name: newCategory, sortOrder: 0 } });
      setNewCategory('');
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
    } catch (error) {
      toast.error(t('เพิ่มหมวดไม่สำเร็จ', 'Could not add category'), errorMessage(error, locale));
    }
  };

  const importCsv = async () => {
    if (!csvText.trim()) return;
    setSaving(true);
    try {
      const result = await api<{ imported: number; errors: Array<{ row: number; message: string }> }>(
        '/products/import',
        { method: 'POST', body: { csv: csvText } },
      );
      setImportResult(result.data);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(t('นำเข้าแล้ว', 'Import complete'), `${result.data.imported} ${t('รายการ', 'rows')}`);
    } catch (error) {
      toast.error(t('นำเข้าไม่สำเร็จ', 'Import failed'), errorMessage(error, locale));
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error(t('ไฟล์รูปไม่รองรับ', 'Unsupported image'), 'PNG, JPEG, WebP');
      return;
    }
    if (file.size > 1_300_000) {
      toast.error(t('รูปใหญ่เกินไป', 'Image too large'), t('สูงสุด 1.3 MB', 'Max 1.3 MB'));
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await api<{ url: string }>('/uploads/product-image', {
        method: 'POST',
        body: { mimeType: file.type, dataBase64 },
      });
      setDraft((prev) => ({ ...prev, imageUrl: result.data.url }));
      toast.success(t('อัปโหลดรูปแล้ว', 'Image uploaded'));
    } catch (error) {
      toast.error(t('อัปโหลดไม่สำเร็จ', 'Upload failed'), errorMessage(error, locale));
    } finally {
      setUploading(false);
    }
  };

  const variableRow = useMemo(
    () => (draft.type === 'variable' && draft.variants.length === 0 ? true : false),
    [draft.type, draft.variants.length],
  );

  return (
    <PageBody>
      <PageHeader
        title={t('สินค้า', 'Products')}
        description={t('แคตตาล็อก ราคา ต้นทุน และตัวเลือกสินค้า', 'Catalogue, prices, costs and variants.')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<FolderPlus className="h-4 w-4" />} onClick={() => setCategoryOpen(true)}>
              {t('หมวดหมู่', 'Categories')}
            </Button>
            {can('products.read') ? (
              <Button
                variant="secondary"
                leftIcon={<Download className="h-4 w-4" />}
                onClick={() => void downloadFile('/products/export.csv', 'nexora-products.csv')}
              >
                {t('ส่งออก', 'Export')}
              </Button>
            ) : null}
            {can('products.create') ? (
              <>
                <Button variant="secondary" leftIcon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
                  {t('นำเข้า CSV', 'Import')}
                </Button>
                <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  {t('เพิ่มสินค้า', 'Add product')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full max-w-[280px]">
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              placeholder={t('ค้นหาชื่อ SKU หรือบาร์โค้ด', 'Search name, SKU or barcode')}
            />
          </div>
          <Select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setPage(1);
            }}
            className="h-10 w-[180px] text-[12px]"
          >
            <option value="">{t('ทุกหมวดหมู่', 'All categories')}</option>
            {(categories.data?.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="h-10 w-[150px] text-[12px]"
          >
            <option value="">{t('ทุกสถานะ', 'All statuses')}</option>
            <option value="active">{t('ใช้งาน', 'Active')}</option>
            <option value="draft">{t('ฉบับร่าง', 'Draft')}</option>
            <option value="archived">{t('เก็บแล้ว', 'Archived')}</option>
          </Select>
          <span className="ml-auto text-[11px] text-faint">
            {number(Number(meta?.total ?? rows.length))} {t('รายการ', 'products')}
          </span>
        </div>
      </Card>

      {products.isError ? (
        <InlineAlert tone="danger">{errorMessage(products.error, locale)}</InlineAlert>
      ) : (
        <Card>
          {products.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} className="h-11" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Package className="h-5 w-5" />}
              title={t('ยังไม่มีสินค้า', 'No products yet')}
              description={t('เพิ่มสินค้าแรกหรือนำเข้าจาก CSV เพื่อเริ่มขาย', 'Add your first product or import a CSV to start selling.')}
              action={
                can('products.create') ? (
                  <Button variant="primary" onClick={openCreate}>
                    {t('เพิ่มสินค้า', 'Add product')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('สินค้า', 'Product')}</TH>
                    <TH>{t('หมวดหมู่', 'Category')}</TH>
                    <TH align="right">{t('ราคาขาย', 'Price')}</TH>
                    <TH align="right">{t('สต๊อก', 'Stock')}</TH>
                    <TH>{t('สถานะ', 'Status')}</TH>
                    <TH align="right">{t('จัดการ', 'Actions')}</TH>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => {
                    const sku = product.variants[0]?.sku ?? '—';
                    const low = product.trackInventory && product.onHand <= product.reorderPoint;
                    return (
                      <TR key={product.id}>
                        <TD>
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2 text-[11px] font-semibold text-muted">
                              {product.imageUrl ? (
                                <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                product.name.slice(0, 1)
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[12.5px] font-medium text-text">{product.name}</p>
                              <p className="text-[10px] text-faint">
                                {sku} · {product.variants.length} {t('ตัวเลือก', 'variants')}
                              </p>
                            </div>
                          </div>
                        </TD>
                        <TD className="text-[12px] text-muted">{product.categoryName ?? '—'}</TD>
                        <TD align="right" className="num text-[12px]">
                          {product.minPriceSatang === product.maxPriceSatang
                            ? money(product.minPriceSatang)
                            : `${money(product.minPriceSatang)} – ${money(product.maxPriceSatang)}`}
                        </TD>
                        <TD align="right">
                          <span className={cn('num text-[12px]', low && 'text-amber')}>{number(product.onHand)}</span>
                          {low ? <span className="ml-1 text-[9px] text-amber">LOW</span> : null}
                        </TD>
                        <TD>
                          <Badge tone={product.status === 'active' ? 'jade' : product.status === 'draft' ? 'amber' : 'neutral'}>
                            {product.status === 'active' ? t('ใช้งาน', 'Active') : product.status === 'draft' ? t('ฉบับร่าง', 'Draft') : t('เก็บแล้ว', 'Archived')}
                          </Badge>
                        </TD>
                        <TD align="right">
                          <div className="flex justify-end gap-1">
                            {can('products.update') ? (
                              <Button size="icon-sm" variant="ghost" onClick={() => openEdit(product)} aria-label={t('แก้ไข', 'Edit')}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                            {can('products.delete') && product.status !== 'archived' ? (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => setArchiveTarget(product)}
                                aria-label={t('เก็บสินค้า', 'Archive')}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination
                page={page}
                totalPages={Number(meta?.totalPages ?? 1)}
                total={Number(meta?.total ?? 0)}
                onPage={setPage}
              />
            </>
          )}
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('แก้ไขสินค้า', 'Edit product') : t('เพิ่มสินค้า', 'New product')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()} disabled={!draft.name.trim()}>
              {t('บันทึก', 'Save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('ชื่อสินค้า', 'Product name')} required className="sm:col-span-2">
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} data-autofocus />
            </Field>
            <Field label={t('ประเภท', 'Type')}>
              <Select
                value={draft.type}
                onChange={(event) => {
                  const type = event.target.value as 'simple' | 'variable';
                  setDraft({
                    ...draft,
                    type,
                    variants:
                      type === 'variable' && draft.variants.length === 0
                        ? [{ name: 'ตัวเลือก 1', sku: '', barcode: '', priceSatang: draft.priceSatang, costSatang: draft.costSatang, isDefault: true }]
                        : draft.variants,
                  });
                }}
              >
                <option value="simple">{t('สินค้าเดี่ยว', 'Simple product')}</option>
                <option value="variable">{t('สินค้าหลายตัวเลือก', 'Variable product')}</option>
              </Select>
            </Field>
            <Field label={t('สถานะ', 'Status')}>
              <Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="active">{t('ใช้งาน', 'Active')}</option>
                <option value="draft">{t('ฉบับร่าง', 'Draft')}</option>
                <option value="archived">{t('เก็บแล้ว', 'Archived')}</option>
              </Select>
            </Field>
            {draft.type === 'simple' ? (
              <>
                <Field label="SKU">
                  <Input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} />
                </Field>
                <Field label={t('บาร์โค้ด', 'Barcode')}>
                  <Input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} />
                </Field>
              </>
            ) : null}
            <Field label={t('หมวดหมู่', 'Category')}>
              <Select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
                <option value="">{t('ไม่ระบุ', 'None')}</option>
                {(categories.data?.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('แบรนด์', 'Brand')}>
              <Select value={draft.brandId} onChange={(event) => setDraft({ ...draft, brandId: event.target.value })}>
                <option value="">{t('ไม่ระบุ', 'None')}</option>
                {(brands.data?.data ?? []).map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('หน่วย', 'Unit')}>
              <Select value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value })}>
                <option value="">{t('ไม่ระบุ', 'None')}</option>
                {(units.data?.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('จุดสั่งซื้อ', 'Reorder point')}>
              <Input
                type="number"
                min={0}
                value={draft.reorderPoint}
                onChange={(event) => setDraft({ ...draft, reorderPoint: Number(event.target.value) || 0 })}
              />
            </Field>
            {draft.type === 'simple' ? (
              <>
                <Field label={t('ราคาขาย (บาท)', 'Selling price (THB)')} required>
                  <MoneyInput value={draft.priceSatang} onChange={(value) => setDraft({ ...draft, priceSatang: value })} />
                </Field>
                <Field label={t('ต้นทุน (บาท)', 'Cost (THB)')} required>
                  <MoneyInput value={draft.costSatang} onChange={(value) => setDraft({ ...draft, costSatang: value })} />
                </Field>
              </>
            ) : null}
            <Field label={t('ราคาเปรียบเทียบ', 'Compare-at price')} hint={t('ไม่บังคับ', 'Optional')}>
              <MoneyInput value={draft.compareAtSatang} onChange={(value) => setDraft({ ...draft, compareAtSatang: value })} />
            </Field>
            <div className="sm:col-span-2">
              <Switch
                checked={draft.trackInventory}
                onChange={(value) => setDraft({ ...draft, trackInventory: value })}
                label={t('ติดตามสต๊อก', 'Track inventory')}
                description={t('ปิดสำหรับสินค้าที่ไม่ต้องนับสต๊อก', 'Disable for services or untracked items.')}
              />
            </div>
            <Field label={t('รายละเอียด', 'Description')} className="sm:col-span-2">
              <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} />
            </Field>
            <Field
              label={t('รูปสินค้า', 'Product image')}
              hint={t('อัปโหลดรูปจริง หรือเลือกภาพหมวดหมู่', 'Upload a real photo or pick category artwork.')}
              className="sm:col-span-2"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
                  {draft.imageUrl ? (
                    <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[20px] font-semibold text-faint">
                      {draft.name.slice(0, 1) || 'N'}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      loading={uploading}
                      leftIcon={<Upload className="h-3.5 w-3.5" />}
                      onClick={() => fileRef.current?.click()}
                    >
                      {t('อัปโหลดรูป', 'Upload image')}
                    </Button>
                    {draft.imageUrl ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDraft((prev) => ({ ...prev, imageUrl: '' }))}
                      >
                        {t('ลบรูป', 'Remove')}
                      </Button>
                    ) : null}
                  </div>
                  <Input
                    value={draft.imageUrl}
                    onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
                    placeholder="/uploads/… หรือ https://…"
                    className="text-[11.5px]"
                  />
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadImage(file);
                  event.target.value = '';
                }}
              />
              <div className="mt-3">
                <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
                  {t('ภาพหมวดหมู่', 'Category artwork')}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {CATEGORY_ART.map((art) => (
                    <button
                      key={art.key}
                      type="button"
                      onClick={() => setDraft({ ...draft, imageUrl: art.url })}
                      className={cn(
                        'h-14 w-[72px] shrink-0 overflow-hidden rounded-md border bg-surface-2 transition-colors',
                        draft.imageUrl === art.url ? 'border-jade ring-2 ring-jade/20' : 'border-line hover:border-jade-border',
                      )}
                      title={t(art.labelTh, art.labelEn)}
                    >
                      <img src={art.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </Field>
          </div>

          {draft.type === 'variable' || variableRow ? (
            <div className="rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <p className="text-[12px] font-medium">{t('ตัวเลือกสินค้า', 'Variants')}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      variants: [
                        ...draft.variants,
                        { name: '', sku: '', barcode: '', priceSatang: draft.priceSatang, costSatang: draft.costSatang, isDefault: false },
                      ],
                    })
                  }
                >
                  {t('เพิ่มตัวเลือก', 'Add variant')}
                </Button>
              </div>
              <div className="space-y-2 p-3">
                {draft.variants.map((variant, index) => (
                  <div key={index} className="grid gap-2 rounded-md border border-line/70 p-2 sm:grid-cols-12">
                    <Input
                      className="h-9 sm:col-span-3"
                      placeholder={t('ชื่อ เช่น S, M, ดำ', 'Name e.g. S, Black')}
                      value={variant.name}
                      onChange={(event) => {
                        const variants = [...draft.variants];
                        variants[index] = { ...variant, name: event.target.value };
                        setDraft({ ...draft, variants });
                      }}
                    />
                    <Input
                      className="h-9 sm:col-span-3"
                      placeholder="SKU"
                      value={variant.sku}
                      onChange={(event) => {
                        const variants = [...draft.variants];
                        variants[index] = { ...variant, sku: event.target.value };
                        setDraft({ ...draft, variants });
                      }}
                    />
                    <div className="sm:col-span-3">
                      <MoneyInput
                        className="h-9"
                        value={variant.priceSatang}
                        onChange={(value) => {
                          const variants = [...draft.variants];
                          variants[index] = { ...variant, priceSatang: value };
                          setDraft({ ...draft, variants });
                        }}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <MoneyInput
                        className="h-9"
                        value={variant.costSatang}
                        onChange={(value) => {
                          const variants = [...draft.variants];
                          variants[index] = { ...variant, costSatang: value };
                          setDraft({ ...draft, variants });
                        }}
                      />
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="sm:col-span-1"
                      onClick={() => setDraft({ ...draft, variants: draft.variants.filter((_, i) => i !== index) })}
                      aria-label="Remove variant"
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <p className="text-[10px] text-faint">
                  {t('ช่องแรกคือราคาขาย ช่องที่สองคือต้นทุน', 'First money field is price, second is cost.')}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => void archive()}
        title={t('เก็บสินค้า', 'Archive product')}
        description={
          <>
            {t('สินค้าที่เก็บแล้วจะไม่แสดงในหน้าขาย แต่ประวัติการขายยังอยู่ครบ', 'Archived products disappear from the terminal; sales history stays intact.')}
            <p className="mt-2 font-medium text-text">{archiveTarget?.name}</p>
          </>
        }
        confirmLabel={t('เก็บสินค้า', 'Archive')}
      />

      <Modal open={categoryOpen} onClose={() => setCategoryOpen(false)} title={t('หมวดหมู่สินค้า', 'Product categories')} size="sm">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder={t('ชื่อหมวดใหม่', 'New category name')} />
            <Button variant="primary" size="sm" onClick={() => void createCategory()}>
              {t('เพิ่ม', 'Add')}
            </Button>
          </div>
          <div className="divide-y divide-line rounded-lg border border-line">
            {(categories.data?.data ?? []).map((category) => (
              <div key={category.id} className="flex items-center justify-between px-3 py-2 text-[12px]">
                <span>{category.name}</span>
                <span className="num text-[10px] text-faint">{category.productCount ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportResult(null);
        }}
        title={t('นำเข้าสินค้าจาก CSV', 'Import products from CSV')}
        description="Columns: name,sku,barcode,category,price,cost,status"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              {t('ปิด', 'Close')}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void importCsv()} disabled={!csvText.trim()}>
              {t('นำเข้า', 'Import')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            rows={10}
            placeholder={'name,sku,barcode,category,price,cost,status\nกาแฟลาเต้,LATTE-01,885000000001,กาแฟ,75,28,active'}
            className="font-mono text-[11px]"
          />
          {importResult ? (
            <InlineAlert tone={importResult.errors.length ? 'warning' : 'info'}>
              {t('นำเข้าสำเร็จ', 'Imported')} {importResult.imported}
              {importResult.errors.length ? ` · ${importResult.errors.length} ${t('แถวผิดพลาด', 'bad rows')}` : ''}
            </InlineAlert>
          ) : null}
        </div>
      </Modal>
    </PageBody>
  );
}
