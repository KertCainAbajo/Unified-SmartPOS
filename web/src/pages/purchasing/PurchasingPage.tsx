import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProductSearch } from '../../components/ProductSearch';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select, Tabs } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Paginated, Product, PurchaseOrder, Supplier } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

type Tab = 'orders' | 'receipts' | 'suppliers';

export function PurchasingPage() {
  const { can } = useTenant();
  const [tab, setTab] = useState<Tab>(can('purchasing.view') ? 'orders' : 'suppliers');
  if (!can('purchasing.view') && !can('suppliers.view')) return <NoAccess what="purchasing" />;

  const tabs = [
    ...(can('purchasing.view') ? [{ value: 'orders' as Tab, label: 'Purchase orders' }, { value: 'receipts' as Tab, label: 'Goods receipts' }] : []),
    ...(can('suppliers.view') ? [{ value: 'suppliers' as Tab, label: 'Suppliers' }] : []),
  ];

  return (
    <>
      <PageHeader title="Purchasing" description="Order from suppliers and receive goods into stock (updates average cost)." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'orders' && <OrdersTab />}
      {tab === 'receipts' && <ReceiptsTab />}
      {tab === 'suppliers' && <SuppliersTab />}
    </>
  );
}

/* ------------------------------------------------------------------ Purchase orders */

function OrdersTab() {
  const { can, branch } = useTenant();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useTenantQuery<Paginated<PurchaseOrder>>('/purchase-orders', { status, branch_id: branch?.id, page });

  return (
    <Card
      padded={false}
      title={`Purchase orders — ${branch?.name ?? ''}`}
      actions={can('purchasing.manage') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New PO</Button>}
    >
      <div className="border-b border-slate-100 p-4">
        <Select className="max-w-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          {['draft', 'ordered', 'partially_received', 'received', 'closed', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(o) => o.id}
        onRowClick={(o) => setOpen(o.id)}
        empty="No purchase orders."
        columns={[
          { header: 'Reference', cell: (o) => <span className="font-medium">{o.reference}</span> },
          { header: 'Supplier', cell: (o) => o.supplier?.name ?? '—' },
          { header: 'Order date', cell: (o) => formatDate(o.order_date) },
          { header: 'Status', cell: (o) => <Badge status={o.status} /> },
          { header: 'Total', cell: (o) => formatMoney(o.total), align: 'right' },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
      <OrderDetail id={open} onClose={() => setOpen(null)} />
      <CreateOrder open={creating} onClose={() => setCreating(false)} />
    </Card>
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
        title={o ? `${o.reference} · ${o.supplier?.name ?? ''}` : 'Purchase order'}
        size="lg"
        footer={
          o && (
            <>
              {can('purchasing.manage') && (o.status === 'draft' || o.status === 'ordered') && <Button variant="secondary" onClick={() => act.mutate({ id: o.id, action: 'cancel' })}>Cancel PO</Button>}
              {can('purchasing.manage') && o.status === 'draft' && <Button loading={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'order' })}>Mark as ordered</Button>}
              {can('purchasing.manage') && o.status === 'partially_received' && <Button variant="secondary" onClick={() => { const reason = prompt('Why close this PO? The remaining quantity will not be received.'); if (reason) act.mutate({ id: o.id, action: 'close', reason }); }}>Close short</Button>}
              {can('purchasing.receive') && receivable && <Button onClick={() => setReceiving(true)}>Receive goods</Button>}
            </>
          )
        }
      >
        {o && (
          <>
            <p className="mb-3 text-sm text-slate-600"><Badge status={o.status} /> <span className="ml-2">Ordered {formatDate(o.order_date)}{o.expected_date ? ` · expected ${formatDate(o.expected_date)}` : ''}</span></p>
            <DataTable
              rows={o.items ?? []}
              rowKey={(i) => i.id}
              columns={[
                { header: 'Product', cell: (i) => i.product?.name ?? i.product_id },
                { header: 'Ordered', cell: (i) => formatQty(i.quantity_ordered), align: 'right' },
                { header: 'Received', cell: (i) => formatQty(i.quantity_received), align: 'right' },
                { header: 'Unit cost', cell: (i) => formatMoney(i.unit_cost), align: 'right' },
                { header: 'Line total', cell: (i) => formatMoney(i.line_total), align: 'right' },
              ]}
            />
            <p className="mt-3 text-right text-sm font-semibold">Total {formatMoney(o.total)}</p>
          </>
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

  return (
    <Modal
      open
      onClose={onClose}
      title={`Receive — ${order.reference}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={receive.isPending}
            onClick={() =>
              receive.mutate({
                branch_id: order.branch_id,
                purchase_order_id: order.id,
                supplier_invoice_number: invoice || null,
                items: outstanding.filter((l) => Number(qty[l.item.id]) > 0).map((l) => ({ purchase_order_item_id: l.item.id, quantity: qty[l.item.id] })),
              })
            }
          >
            Post receipt
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={receive.error && fieldErrors.length === 0 ? receive.error : null} />
        {fieldErrors.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
        <Field label="Supplier invoice no.">{(id) => <Input id={id} value={invoice} onChange={(e) => setInvoice(e.target.value)} />}</Field>
        {outstanding.map((l) => (
          <div key={l.item.id} className="flex items-center gap-3 text-sm">
            <span className="flex-1">{l.item.product?.name}</span>
            <span className="text-slate-500">of {formatQty(String(l.remaining))} outstanding</span>
            <Input className="h-8 w-28" inputMode="decimal" value={qty[l.item.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.item.id]: e.target.value }))} aria-label={`Receive ${l.item.product?.name}`} />
          </div>
        ))}
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New purchase order — deliver to ${branch?.name ?? ''}`}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!supplierId || lines.length === 0} loading={create.isPending} onClick={() => create.mutate({ branch_id: branch?.id, supplier_id: Number(supplierId), expected_date: expected || null, items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity, unit_cost: l.unit_cost })) })}>Create PO</Button></>}
    >
      <div className="space-y-4">
        <ErrorBanner error={create.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier">{(id) => <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Choose…</option>{suppliers.data?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
          <Field label="Expected delivery">{(id) => <Input id={id} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />}</Field>
        </div>
        <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: '', unit_cost: p.cost_price ?? '' }]))} />
        {lines.map((l, i) => (
          <div key={l.product.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-40 flex-1">{l.product.name}</span>
            <Input className="h-8 w-24" inputMode="decimal" placeholder="Qty" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} aria-label="Quantity" />
            <Input className="h-8 w-28" inputMode="decimal" placeholder="Unit cost" value={l.unit_cost} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, unit_cost: e.target.value } : x)))} aria-label="Unit cost" />
            <button className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Receipts */

function ReceiptsTab() {
  const { branch } = useTenant();
  const [page, setPage] = useState(1);
  const list = useTenantQuery<Paginated<{ id: number; reference: string; purchase_order_id: number | null; supplier: { name: string } | null; supplier_invoice_number: string | null; received_at: string; total_cost: string; items: unknown[] }>>('/goods-receipts', { branch_id: branch?.id, page });
  return (
    <Card padded={false}>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        empty="No goods received yet."
        columns={[
          { header: 'Reference', cell: (r) => <span className="font-medium">{r.reference}</span> },
          { header: 'Received', cell: (r) => formatDateTime(r.received_at) },
          { header: 'Supplier', cell: (r) => r.supplier?.name ?? '—' },
          { header: 'Invoice', cell: (r) => r.supplier_invoice_number ?? '—' },
          { header: 'Lines', cell: (r) => r.items.length, align: 'right' },
          { header: 'Total cost', cell: (r) => formatMoney(r.total_cost), align: 'right' },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Card>
  );
}

/* ------------------------------------------------------------------ Suppliers */

function SuppliersTab() {
  const { can } = useTenant();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const list = useTenantQuery<Paginated<Supplier>>('/suppliers', { page });
  return (
    <Card padded={false} title="Suppliers" actions={can('suppliers.manage') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add supplier</Button>}>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(s) => s.id}
        onRowClick={can('suppliers.manage') ? (s) => setEditing(s) : undefined}
        empty="No suppliers yet."
        columns={[
          { header: 'Name', cell: (s) => <span className="font-medium">{s.name}</span> },
          { header: 'Contact', cell: (s) => s.contact_person ?? '—' },
          { header: 'Phone', cell: (s) => s.phone ?? '—' },
          { header: 'Email', cell: (s) => s.email ?? '—' },
          { header: 'Status', cell: (s) => <Badge status={s.is_active ? 'active' : 'archived'}>{s.is_active ? 'Active' : 'Inactive'}</Badge> },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
      <SupplierForm supplier={editing} onClose={() => setEditing(null)} />
    </Card>
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
  const text = (k: Exclude<keyof typeof form, 'is_active'>, label: string) => (
    <Field label={label} error={err(k)}>{(id) => <Input id={id} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />}</Field>
  );

  return (
    <Modal open={supplier !== null} onClose={onClose} title={isNew ? 'Add supplier' : 'Edit supplier'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(form)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('name', 'Name')}
        {text('contact_person', 'Contact person')}
        {text('phone', 'Phone')}
        {text('email', 'Email')}
        {text('tin', 'TIN')}
        {text('address', 'Address')}
        {!isNew && <Checkbox label="Active" checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />}
      </div>
    </Modal>
  );
}
