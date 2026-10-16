import { Check, ClipboardList, FileText, Mail, PackageCheck, Phone, Plus, RotateCcw, ShoppingBag, Truck, Users, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { LineItem, LineList, ProductSearch, QtyInput } from '../../components/ProductSearch';
import { Avatar, Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, FormSection, Input, LoadingRows, Modal, PageHeader, Pagination, Segmented, Select, Tabs, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Paginated, Product, PurchaseOrder, Supplier } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

type Tab = 'orders' | 'receipts' | 'suppliers';

export function PurchasingPage() {
  const { can, branch } = useTenant();
  const [tab, setTab] = useState<Tab>(can('purchasing.view') ? 'orders' : 'suppliers');
  if (!can('purchasing.view') && !can('suppliers.view')) return <NoAccess what="purchasing" />;

  const tabs = [
    ...(can('purchasing.view') ? [{ value: 'orders' as Tab, label: 'Purchase orders', icon: ClipboardList }, { value: 'receipts' as Tab, label: 'Goods receipts', icon: PackageCheck }] : []),
    ...(can('suppliers.view') ? [{ value: 'suppliers' as Tab, label: 'Suppliers', icon: Users }] : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Purchasing"
        title="Purchasing"
        description={<>Order from suppliers and receive goods into stock at <strong className="font-semibold text-slate-700">{branch?.name ?? 'your branch'}</strong>. Receipts update average cost.</>}
      />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <div key={tab} className="auth-fade">
        {tab === 'orders' && <OrdersTab />}
        {tab === 'receipts' && <ReceiptsTab />}
        {tab === 'suppliers' && <SuppliersTab />}
      </div>
    </>
  );
}

const Panel = ({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) => (
  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
    {toolbar && <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">{toolbar}</div>}
    {children}
  </section>
);

/* ------------------------------------------------------------------ Purchase orders */

const PO_FLOW = ['draft', 'ordered', 'received'] as const;

function OrdersTab() {
  const { can, branch } = useTenant();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useTenantQuery<Paginated<PurchaseOrder>>('/purchase-orders', { status, branch_id: branch?.id, page });
  const rows = list.data?.data ?? [];

  return (
    <Panel toolbar={
      <>
        <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'ordered', label: 'Ordered' }, { value: 'partially_received', label: 'Partial' }, { value: 'received', label: 'Received' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' }]} />
        {can('purchasing.manage') && <Button className="sm:ml-auto" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New purchase order</Button>}
      </>
    }>
      {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading purchase orders" /> : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={status ? 'No orders with this status' : 'No purchase orders yet'}
          description={status ? 'Pick another status to see more.' : 'Create a purchase order to request stock from a supplier.'}
          action={status ? <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => setStatus('')}>Show all</Button>
            : can('purchasing.manage') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New purchase order</Button>} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpen(o.id)} className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none">
                <Avatar name={o.supplier?.name ?? '?'} square />
                <span className="min-w-40 flex-1">
                  <span className="block font-medium text-slate-900">{o.supplier?.name ?? 'Unknown supplier'}</span>
                  <span className="block text-xs text-slate-400"><span className="font-mono">{o.reference}</span> · ordered {formatDate(o.order_date)}{o.expected_date && <> · due {formatDate(o.expected_date)}</>}</span>
                </span>
                <Badge status={o.status} />
                <span className="w-32 text-right font-display font-semibold tabular-nums text-slate-900">{formatMoney(o.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} data={list.data} onPage={setPage} />
      <OrderDetail id={open} onClose={() => setOpen(null)} />
      <CreateOrder open={creating} onClose={() => setCreating(false)} />
    </Panel>
  );
}

function OrderStepper({ status }: { status: PurchaseOrder['status'] }) {
  if (status === 'cancelled' || status === 'closed') {
    return (
      <div className={cx('flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ring-1', status === 'cancelled' ? 'bg-rose-50 text-rose-700 ring-rose-100' : 'bg-slate-50 text-slate-600 ring-slate-200')}>
        <XCircle className="size-4" /> {status === 'cancelled' ? 'This purchase order was cancelled.' : 'Closed short. The remaining quantity will not be received.'}
      </div>
    );
  }
  const at = status === 'partially_received' ? 1.5 : PO_FLOW.indexOf(status);
  return (
    <ol className="flex items-center">
      {PO_FLOW.map((s, i) => (
        <li key={s} className={cx('flex items-center', i < PO_FLOW.length - 1 && 'flex-1')}>
          <span className="flex items-center gap-2">
            <span className={cx('grid size-7 place-items-center rounded-full text-xs font-bold', i < at ? 'bg-brand-600 text-white' : i === at ? 'bg-sun-400 text-brand-900 ring-4 ring-sun-300/40' : 'bg-slate-100 text-slate-400')}>
              {i < at ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cx('whitespace-nowrap text-xs font-semibold', i <= at ? 'text-slate-900' : 'text-slate-400')}>{s === 'draft' ? 'Draft' : s === 'ordered' ? 'Ordered' : 'Received'}</span>
          </span>
          {i < PO_FLOW.length - 1 && (
            <span className="mx-3 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <span className="block h-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(1, at - i)) * 100}%` }} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function OrderDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { can } = useTenant();
  const detail = useTenantQuery<{ data: PurchaseOrder }>(`/purchase-orders/${id}`, undefined, { enabled: id !== null });
  const [receiving, setReceiving] = useState(false);
  const act = useTenantMutation<{ id: number; action: 'order' | 'cancel' | 'close'; reason?: string }>('POST', (b) => `/purchase-orders/${b.id}/${b.action}`, { success: 'Purchase order updated.' });
  const o = detail.data?.data;
  const receivable = o && (o.status === 'ordered' || o.status === 'partially_received');

  return (
    <>
      <Modal
        open={id !== null && !receiving}
        onClose={onClose}
        title={o ? o.supplier?.name ?? 'Purchase order' : 'Purchase order'}
        description={o ? <><span className="font-mono">{o.reference}</span> · ordered {formatDate(o.order_date)}{o.expected_date ? ` · expected ${formatDate(o.expected_date)}` : ''}</> : undefined}
        icon={ClipboardList}
        size="lg"
        footer={
          o && (
            <>
              {can('purchasing.manage') && (o.status === 'draft' || o.status === 'ordered') && <Button variant="secondary" onClick={() => act.mutate({ id: o.id, action: 'cancel' })}>Cancel PO</Button>}
              {can('purchasing.manage') && o.status === 'draft' && <Button icon={<Truck className="size-4" />} loading={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'order' })}>Mark as ordered</Button>}
              {can('purchasing.manage') && o.status === 'partially_received' && <Button variant="secondary" onClick={() => { const reason = prompt('Why close this PO? The remaining quantity will not be received.'); if (reason) act.mutate({ id: o.id, action: 'close', reason }); }}>Close short</Button>}
              {can('purchasing.receive') && receivable && <Button icon={<PackageCheck className="size-4" />} onClick={() => setReceiving(true)}>Receive goods</Button>}
            </>
          )
        }
      >
        {!o ? (detail.error ? <ErrorBanner error={detail.error} /> : <LoadingRows rows={3} />) : (
          <div className="space-y-5">
            <OrderStepper status={o.status} />
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-4 py-2 text-left font-semibold">Product</th><th className="px-4 py-2 text-left font-semibold">Received</th><th className="px-4 py-2 text-right font-semibold">Unit cost</th><th className="px-4 py-2 text-right font-semibold">Line total</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(o.items ?? []).map((i) => {
                    const pct = Number(i.quantity_ordered) > 0 ? Math.min(100, (Number(i.quantity_received) / Number(i.quantity_ordered)) * 100) : 0;
                    return (
                      <tr key={i.id}>
                        <td className="px-4 py-2.5"><span className="block font-medium text-slate-900">{i.product?.name ?? `#${i.product_id}`}</span>{i.product?.sku && <span className="font-mono text-[11px] text-slate-400">{i.product.sku}</span>}</td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><span className={cx('block h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} /></span>
                            <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{formatQty(i.quantity_received)} / {formatQty(i.quantity_ordered)}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatMoney(i.unit_cost)}</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-900">{formatMoney(i.line_total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="bg-brand-50/60"><td colSpan={3} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-brand-700">Order total</td><td className="px-4 py-3 text-right font-display text-base font-bold tabular-nums text-brand-900">{formatMoney(o.total)}</td></tr></tfoot>
              </table>
            </div>
            {o.notes && <p className="rounded-xl bg-cream/60 px-3 py-2 text-sm text-slate-700 ring-1 ring-sun-300/40">“{o.notes}”</p>}
          </div>
        )}
      </Modal>
      {o && receiving && <ReceiveModal order={o} onClose={() => setReceiving(false)} />}
    </>
  );
}

function ReceiveModal({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const outstanding = (order.items ?? []).map((i) => ({ item: i, remaining: Math.max(Number(i.quantity_ordered) - Number(i.quantity_received), 0) })).filter((l) => l.remaining > 0);
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(outstanding.map((l) => [l.item.id, formatQty(String(l.remaining))])));
  const [invoice, setInvoice] = useState('');
  const receive = useTenantMutation<unknown>('POST', '/goods-receipts', { success: 'Goods received into stock.', onSuccess: onClose, toastErrors: false });
  const fieldErrors = receive.error instanceof ApiError ? Object.values(receive.error.errors).flat() : [];
  const value = outstanding.reduce((s, l) => s + (Number(qty[l.item.id]) || 0) * Number(l.item.unit_cost), 0);

  return (
    <Modal
      open
      onClose={onClose}
      title="Receive goods"
      description={<><span className="font-mono">{order.reference}</span> · {order.supplier?.name}</>}
      icon={PackageCheck}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={receive.isPending}
            disabled={!outstanding.some((l) => Number(qty[l.item.id]) > 0)}
            onClick={() =>
              receive.mutate({
                branch_id: order.branch_id,
                purchase_order_id: order.id,
                supplier_invoice_number: invoice || null,
                items: outstanding.filter((l) => Number(qty[l.item.id]) > 0).map((l) => ({ purchase_order_item_id: l.item.id, quantity: qty[l.item.id] })),
              })
            }
          >
            Post receipt · {formatMoney(value.toFixed(2))}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <ErrorBanner error={receive.error && fieldErrors.length === 0 ? receive.error : null} />
        {fieldErrors.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
        <Field label="Supplier invoice no." hint="Optional, helps match the supplier's bill.">{(id) => <Input id={id} value={invoice} onChange={(e) => setInvoice(e.target.value)} />}</Field>
        <FormSection title="Quantities arriving">
          <LineList count={outstanding.length} empty="Everything on this order has been received.">
            {outstanding.map((l) => (
              <LineItem key={l.item.id} name={l.item.product?.name ?? `#${l.item.product_id}`} sku={l.item.product?.sku}>
                <span className="text-xs text-slate-500">of <strong className="text-slate-800">{formatQty(String(l.remaining))}</strong> outstanding</span>
                <QtyInput label={`Receive ${l.item.product?.name}`} suffix={l.item.product?.unit} value={qty[l.item.id] ?? ''} onChange={(v) => setQty((q) => ({ ...q, [l.item.id]: v }))} />
              </LineItem>
            ))}
          </LineList>
        </FormSection>
      </div>
    </Modal>
  );
}

function CreateOrder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branch } = useTenant();
  const suppliers = useTenantQuery<Paginated<Supplier>>('/suppliers', { active_only: 1, per_page: 100 }, { enabled: open });
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<{ product: Product; quantity: string; unit_cost: string }[]>([]);
  const create = useTenantMutation<unknown>('POST', '/purchase-orders', { success: 'Purchase order created (draft).', onSuccess: () => { setLines([]); onClose(); }, toastErrors: false });
  const update = (i: number, patch: Partial<{ quantity: string; unit_cost: string }>) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New purchase order"
      description={`Delivered to ${branch?.name ?? 'this branch'}. Saved as a draft.`}
      icon={ShoppingBag}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!supplierId || lines.length === 0} loading={create.isPending} onClick={() => create.mutate({ branch_id: branch?.id, supplier_id: Number(supplierId), expected_date: expected || null, items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity, unit_cost: l.unit_cost })) })}>Create PO</Button></>}
    >
      <div className="space-y-6">
        <ErrorBanner error={create.error} />
        <FormSection title="Supplier">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier">{(id) => <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Choose…</option>{suppliers.data?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            <Field label="Expected delivery">{(id) => <Input id={id} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />}</Field>
          </div>
        </FormSection>
        <FormSection title="Items">
          <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: '', unit_cost: p.cost_price ?? '' }]))} />
          <LineList count={lines.length} empty="Search above to add the products you're ordering."
            header={<span className="normal-case tracking-normal text-slate-700">Total <strong className="font-display text-sm text-brand-900">{formatMoney(total.toFixed(2))}</strong></span>}>
            {lines.map((l, i) => (
              <LineItem key={l.product.id} name={l.product.name} sku={l.product.sku} onRemove={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                <QtyInput label={`Quantity ${l.product.name}`} suffix={l.product.unit} value={l.quantity} onChange={(v) => update(i, { quantity: v })} />
                <QtyInput label={`Unit cost ${l.product.name}`} prefix="₱" placeholder="0.00" value={l.unit_cost} onChange={(v) => update(i, { unit_cost: v })} />
              </LineItem>
            ))}
          </LineList>
        </FormSection>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Receipts */

function ReceiptsTab() {
  const { branch } = useTenant();
  const [page, setPage] = useState(1);
  const list = useTenantQuery<Paginated<{ id: number; reference: string; purchase_order_id: number | null; supplier: { name: string } | null; supplier_invoice_number: string | null; received_at: string; total_cost: string; items: unknown[] }>>('/goods-receipts', { branch_id: branch?.id, page });
  const rows = list.data?.data ?? [];

  return (
    <Panel>
      {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading receipts" /> : rows.length === 0 ? (
        <EmptyState icon={PackageCheck} title="No goods received yet" description="Receive a purchase order and the delivery will be recorded here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-brand-50/40">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><PackageCheck className="size-5" /></span>
              <span className="min-w-40 flex-1">
                <span className="block font-medium text-slate-900">{r.supplier?.name ?? 'Direct receipt'}</span>
                <span className="block text-xs text-slate-400"><span className="font-mono">{r.reference}</span> · {formatDateTime(r.received_at)}</span>
              </span>
              {r.supplier_invoice_number && <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"><FileText className="size-3.5 text-slate-400" />{r.supplier_invoice_number}</span>}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{r.items.length} {r.items.length === 1 ? 'line' : 'lines'}</span>
              <span className="w-32 text-right font-display font-semibold tabular-nums text-slate-900">{formatMoney(r.total_cost)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ Suppliers */

function SuppliersTab() {
  const { can } = useTenant();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const list = useTenantQuery<Paginated<Supplier>>('/suppliers', { page });
  const rows = list.data?.data ?? [];
  const manage = can('suppliers.manage');

  return (
    <Panel toolbar={
      <>
        <p className="text-sm text-slate-500">The companies you buy stock from.</p>
        {manage && <Button className="sm:ml-auto" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add supplier</Button>}
      </>
    }>
      {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading suppliers" /> : rows.length === 0 ? (
        <EmptyState icon={Users} title="No suppliers yet" description="Add the companies you order from so you can create purchase orders."
          action={manage && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add supplier</Button>} />
      ) : (
        <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <article key={s.id} className={cx('group flex flex-col rounded-2xl p-4 ring-1 transition', s.is_active ? 'bg-white ring-slate-200 hover:shadow-md hover:ring-brand-200' : 'bg-slate-50 ring-slate-200')}>
              <div className="flex items-start gap-3">
                <span className={cx(!s.is_active && 'opacity-50 grayscale')}><Avatar name={s.name} square /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display font-semibold text-slate-900">{s.name}</p>
                  <p className="truncate text-xs text-slate-500">{s.contact_person ?? 'No contact person'}</p>
                </div>
                <Badge status={s.is_active ? 'active' : 'archived'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
              </div>
              <div className="mt-4 space-y-1.5 text-sm">
                {s.phone ? <a href={`tel:${s.phone}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-700"><Phone className="size-3.5 text-slate-400" />{s.phone}</a> : <p className="flex items-center gap-2 text-slate-300"><Phone className="size-3.5" />No phone</p>}
                {s.email ? <a href={`mailto:${s.email}`} className="flex items-center gap-2 truncate text-slate-600 hover:text-brand-700"><Mail className="size-3.5 shrink-0 text-slate-400" /><span className="truncate">{s.email}</span></a> : <p className="flex items-center gap-2 text-slate-300"><Mail className="size-3.5" />No email</p>}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                {s.tin ? <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">TIN {s.tin}</span> : <span className="text-xs text-slate-300">No TIN</span>}
                {manage && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>}
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination page={page} data={list.data} onPage={setPage} />
      <SupplierForm supplier={editing} onClose={() => setEditing(null)} />
    </Panel>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier | 'new' | null; onClose: () => void }) {
  const isNew = supplier === 'new';
  const empty = { name: '', contact_person: '', email: '', phone: '', address: '', tin: '', is_active: true };
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (supplier && supplier !== 'new') setForm({ name: supplier.name, contact_person: supplier.contact_person ?? '', email: supplier.email ?? '', phone: supplier.phone ?? '', address: supplier.address ?? '', tin: supplier.tin ?? '', is_active: supplier.is_active });
    else setForm(empty);
  }, [supplier]);
  const save = useTenantMutation<typeof form>(isNew ? 'POST' : 'PATCH', isNew ? '/suppliers' : `/suppliers/${(supplier as Supplier | null)?.id}`, { success: 'Supplier saved.', onSuccess: onClose, toastErrors: false });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const text = (k: Exclude<keyof typeof form, 'is_active'>, label: string, extra: { placeholder?: string; type?: string; className?: string } = {}) => (
    <Field label={label} error={err(k)} className={extra.className}>{(id) => <Input id={id} type={extra.type} placeholder={extra.placeholder} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />}</Field>
  );

  return (
    <Modal open={supplier !== null} onClose={onClose} title={isNew ? 'Add supplier' : 'Edit supplier'} icon={Users} size="lg"
      description={isNew ? 'You can order from them right after saving.' : 'Changes apply to future purchase orders.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!form.name.trim()} loading={save.isPending} onClick={() => save.mutate(form)}>{isNew ? 'Add supplier' : 'Save changes'}</Button></>}>
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-brand-50 to-cream/60 p-3 ring-1 ring-brand-100">
          <span className={cx(!form.is_active && 'opacity-50 grayscale')}><Avatar name={form.name || '?'} square /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-semibold text-slate-900">{form.name.trim() || 'Supplier name'}</p>
            <p className="truncate text-xs text-slate-500">{[form.contact_person, form.phone, form.email].filter(Boolean).join(' · ') || 'Contact details appear here'}</p>
          </div>
        </div>
        <FormSection title="Company">
          <div className="grid gap-4 sm:grid-cols-2">
            {text('name', 'Name', { placeholder: 'e.g. Metro Distributors Inc.', className: 'sm:col-span-2' })}
            {text('tin', 'TIN', { placeholder: '000-000-000-000' })}
            {text('address', 'Address')}
          </div>
        </FormSection>
        <FormSection title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            {text('contact_person', 'Contact person', { className: 'sm:col-span-2' })}
            {text('phone', 'Phone', { type: 'tel', placeholder: '09XX XXX XXXX' })}
            {text('email', 'Email', { type: 'email' })}
          </div>
        </FormSection>
        {!isNew && <Checkbox label="Active — available when creating purchase orders" checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />}
      </div>
    </Modal>
  );
}
