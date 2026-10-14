import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatMoney, formatQty, titleCase } from '../../lib/format';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Category, Paginated, Product, TaxType } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function ProductsPage() {
  const { can, branch } = useTenant();
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('active');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [pricing, setPricing] = useState<Product | null>(null);
  const q = useDebounced(term);
  const list = useTenantQuery<Paginated<Product>>('/products', { q: q || undefined, status, category_id: categoryId, page, with_stock: 1 });
  const categories = useTenantQuery<{ data: Category[] }>('/categories');
  const archive = useTenantMutation<Product>('POST', (p) => `/products/${p.id}/${p.status === 'active' ? 'archive' : 'restore'}`, {
    success: 'Product updated.',
  });

  if (!can('products.view')) return <NoAccess what="products" />;

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalog shared by all branches. Stock shown for the selected branch."
        actions={can('products.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add product</Button>}
      />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <Input placeholder="Search name, SKU or barcode" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} aria-label="Search" />
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} aria-label="Category">
            <option value="">All categories</option>
            {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(p) => p.id}
          empty="No products found."
          columns={[
            { header: 'Product', cell: (p) => <><p className="font-medium text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</p></> },
            { header: 'Category', cell: (p) => p.category?.name ?? '—' },
            { header: 'Tax', cell: (p) => titleCase(p.tax_type) },
            { header: 'Price', cell: (p) => formatMoney(p.price), align: 'right' },
            ...(can('products.price') ? [{ header: 'Cost', cell: (p: Product) => formatMoney(p.cost_price), align: 'right' as const }] : []),
            {
              header: `Stock (${branch?.code ?? ''})`,
              align: 'right',
              cell: (p) => {
                if (!p.track_inventory) return <span className="text-slate-400">n/a</span>;
                const qty = p.stock?.find((s) => s.branch_id === branch?.id)?.quantity ?? '0';
                const low = Number(qty) <= Number(p.reorder_level);
                return <span className={low ? 'font-medium text-amber-700' : ''}>{formatQty(qty)} {p.unit}</span>;
              },
            },
            { header: 'Status', cell: (p) => <Badge status={p.status} /> },
            {
              header: '',
              cell: (p) => (
                <div className="flex justify-end gap-1">
                  {can('products.manage') && <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>}
                  {can('products.price') && <Button size="sm" variant="ghost" onClick={() => setPricing(p)}>Price</Button>}
                  {can('products.manage') && (
                    <Button size="sm" variant="ghost" onClick={() => archive.mutate(p)}>{p.status === 'active' ? 'Archive' : 'Restore'}</Button>
                  )}
                </div>
              ),
            },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>

      <ProductForm product={editing} categories={categories.data?.data ?? []} onClose={() => setEditing(null)} />
      <PriceModal product={pricing} onClose={() => setPricing(null)} />
    </>
  );
}

const blank = { sku: '', barcode: '', name: '', description: '', category_id: '', unit: 'pc', price: '', cost_price: '', tax_type: 'vatable' as TaxType, track_inventory: true, allow_decimal_quantity: false, reorder_level: '0' };

function ProductForm({ product, categories, onClose }: { product: Product | 'new' | null; categories: Category[]; onClose: () => void }) {
  const isNew = product === 'new';
  const [form, setForm] = useState(blank);
  useEffect(() => {
    if (product && product !== 'new') {
      setForm({
        sku: product.sku, barcode: product.barcode ?? '', name: product.name, description: product.description ?? '', category_id: product.category_id ? String(product.category_id) : '',
        unit: product.unit, price: product.price, cost_price: product.cost_price ?? '', tax_type: product.tax_type, track_inventory: product.track_inventory,
        allow_decimal_quantity: product.allow_decimal_quantity, reorder_level: formatQty(product.reorder_level),
      });
    } else if (isNew) setForm(blank);
  }, [product, isNew]);

  const save = useTenantMutation<Record<string, unknown>>(isNew ? 'POST' : 'PATCH', isNew ? '/products' : `/products/${(product as Product | null)?.id}`, {
    success: isNew ? 'Product created.' : 'Product updated.',
    onSuccess: onClose,
    toastErrors: false,
  });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    const body: Record<string, unknown> = {
      sku: form.sku, barcode: form.barcode || null, name: form.name, description: form.description || null,
      category_id: form.category_id ? Number(form.category_id) : null, unit: form.unit, tax_type: form.tax_type,
      track_inventory: form.track_inventory, allow_decimal_quantity: form.allow_decimal_quantity, reorder_level: form.reorder_level || '0',
    };
    if (isNew) {
      body.price = form.price;
      if (form.cost_price) body.cost_price = form.cost_price;
    }
    save.mutate(body);
  }

  return (
    <Modal
      open={product !== null}
      onClose={onClose}
      title={isNew ? 'Add product' : 'Edit product'}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} className="sm:col-span-2" />}
        <Field label="Name" error={err('name')} className="sm:col-span-2">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name')(e.target.value)} />}</Field>
        <Field label="SKU" error={err('sku')} hint="Letters, digits, - _ . / (stored in upper case)">{(id) => <Input id={id} value={form.sku} onChange={(e) => set('sku')(e.target.value)} />}</Field>
        <Field label="Barcode" error={err('barcode')} hint="EAN/UPC check digit is verified">{(id) => <Input id={id} value={form.barcode} onChange={(e) => set('barcode')(e.target.value)} />}</Field>
        <Field label="Category" error={err('category_id')}>
          {(id) => <Select id={id} value={form.category_id} onChange={(e) => set('category_id')(e.target.value)}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
        </Field>
        <Field label="Unit" error={err('unit')} hint="e.g. pc, kg, pack">{(id) => <Input id={id} value={form.unit} onChange={(e) => set('unit')(e.target.value)} />}</Field>
        {isNew ? (
          <>
            <Field label="Selling price (₱)" error={err('price')} hint="VAT-inclusive for VAT-registered businesses">{(id) => <Input id={id} inputMode="decimal" value={form.price} onChange={(e) => set('price')(e.target.value)} />}</Field>
            <Field label="Cost (₱)" error={err('cost_price')}>{(id) => <Input id={id} inputMode="decimal" value={form.cost_price} onChange={(e) => set('cost_price')(e.target.value)} />}</Field>
          </>
        ) : (
          <p className="text-sm text-slate-500 sm:col-span-2">Price: {formatMoney((product as Product | null)?.price)}. Use the Price action to change it (recorded in price history).</p>
        )}
        <Field label="Tax type" error={err('tax_type')}>
          {(id) => <Select id={id} value={form.tax_type} onChange={(e) => set('tax_type')(e.target.value)}><option value="vatable">VATable</option><option value="vat_exempt">VAT-exempt</option><option value="zero_rated">Zero-rated</option></Select>}
        </Field>
        <Field label="Reorder level" error={err('reorder_level')}>{(id) => <Input id={id} inputMode="decimal" value={form.reorder_level} onChange={(e) => set('reorder_level')(e.target.value)} />}</Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox label="Track stock for this product" checked={form.track_inventory} onChange={set('track_inventory')} />
          <Checkbox label="Allow decimal quantities (sold by weight/length)" checked={form.allow_decimal_quantity} onChange={set('allow_decimal_quantity')} />
        </div>
      </div>
    </Modal>
  );
}

function PriceModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const history = useTenantQuery<Paginated<{ id: number; old_price: string | null; new_price: string; old_cost: string | null; new_cost: string | null; reason: string | null; changed_by: { name: string } | null; created_at: string }>>(
    `/products/${product?.id}/price-history`, { per_page: 8 }, { enabled: !!product },
  );
  useEffect(() => {
    setPrice(product?.price ?? '');
    setCost(product?.cost_price ?? '');
    setReason('');
  }, [product]);
  const save = useTenantMutation<{ price: string; cost_price: string; reason: string }>('PATCH', `/products/${product?.id}/price`, { success: 'Price updated.', onSuccess: onClose, toastErrors: false });

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={`Price — ${product?.name ?? ''}`}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate({ price, cost_price: cost, reason })}>Save price</Button></>}
    >
      <ErrorBanner error={save.error} className="mb-4" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Selling price (₱)">{(id) => <Input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
        <Field label="Cost (₱)">{(id) => <Input id={id} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier increase" />}</Field>
      </div>
      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-800">History</h3>
      <DataTable
        rows={history.data?.data}
        loading={history.isPending}
        rowKey={(h) => h.id}
        empty="No changes yet."
        columns={[
          { header: 'When', cell: (h) => formatDateTime(h.created_at) },
          { header: 'Price', cell: (h) => `${h.old_price ? formatMoney(h.old_price) + ' → ' : ''}${formatMoney(h.new_price)}` },
          { header: 'Cost', cell: (h) => (h.new_cost ? `${h.old_cost ? formatMoney(h.old_cost) + ' → ' : ''}${formatMoney(h.new_cost)}` : '—') },
          { header: 'By', cell: (h) => h.changed_by?.name ?? '—' },
          { header: 'Reason', cell: (h) => h.reason ?? '' },
        ]}
      />
    </Modal>
  );
}
