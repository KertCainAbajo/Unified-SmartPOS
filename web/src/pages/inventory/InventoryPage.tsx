import { ClipboardCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ProductSearch } from '../../components/ProductSearch';
import { Badge, Button, Card, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatMoney, formatQty, titleCase } from '../../lib/format';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { InventoryRow, Paginated, Product, StockMovement } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

type Tab = 'stock' | 'low' | 'history' | 'counts';

export function InventoryPage() {
  const { can, branch } = useTenant();
  const [tab, setTab] = useState<Tab>('stock');
  const [adjusting, setAdjusting] = useState(false);
  const [counting, setCounting] = useState(false);

  if (!can('inventory.view')) return <NoAccess what="inventory" />;

  return (
    <>
      <PageHeader
        title="Inventory"
        description={`Stock at ${branch?.name ?? 'your branch'}. Balances change only through recorded movements.`}
        actions={
          <>
            {can('inventory.count') && <Button variant="secondary" icon={<ClipboardCheck className="size-4" />} onClick={() => setCounting(true)}>Stock count</Button>}
            {can('inventory.adjust') && <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting(true)}>Adjust stock</Button>}
          </>
        }
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'stock', label: 'Stock on hand' }, { value: 'low', label: 'Low stock' }, { value: 'history', label: 'History' }, { value: 'counts', label: 'Counts' }]} />
      {tab === 'stock' && <StockTab />}
      {tab === 'low' && <LowStockTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'counts' && <CountsTab />}
      <AdjustModal open={adjusting} onClose={() => setAdjusting(false)} />
      <CountModal open={counting} onClose={() => setCounting(false)} />
    </>
  );
}

function StockTab() {
  const { branch } = useTenant();
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const q = useDebounced(term);
  const list = useTenantQuery<Paginated<InventoryRow>>('/inventory', { branch_id: branch?.id, q: q || undefined, page });
  return (
    <Card padded={false}>
      <div className="border-b border-slate-100 p-4"><Input className="max-w-sm" placeholder="Search product" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} aria-label="Search" /></div>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => `${r.branch_id}-${r.product_id}`}
        empty="No stock records for this branch yet. Record opening stock with Adjust stock."
        columns={[
          { header: 'Product', cell: (r) => <><p className="font-medium text-slate-900">{r.name}</p><p className="text-xs text-slate-500">{r.sku}</p></> },
          { header: 'On hand', cell: (r) => <span className={cx(Number(r.quantity) <= Number(r.reorder_level) && 'font-semibold text-amber-700', Number(r.quantity) < 0 && 'text-red-600')}>{formatQty(r.quantity)} {r.unit}</span>, align: 'right' },
          { header: 'Reorder level', cell: (r) => formatQty(r.reorder_level), align: 'right' },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Card>
  );
}

function LowStockTab() {
  const { branch } = useTenant();
  const [page, setPage] = useState(1);
  const list = useTenantQuery<Paginated<{ branch_id: number; product_id: number; sku: string; name: string; unit: string; quantity: string; reorder_level: string }>>('/inventory/low-stock', { branch_id: branch?.id, page });
  return (
    <Card padded={false}>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => `${r.branch_id}-${r.product_id}`}
        empty="Nothing is below its reorder level."
        columns={[
          { header: 'Product', cell: (r) => <><p className="font-medium text-slate-900">{r.name}</p><p className="text-xs text-slate-500">{r.sku}</p></> },
          { header: 'On hand', cell: (r) => `${formatQty(r.quantity)} ${r.unit}`, align: 'right' },
          { header: 'Reorder level', cell: (r) => formatQty(r.reorder_level), align: 'right' },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Card>
  );
}

const MOVEMENT_TYPES = ['opening', 'adjustment', 'sale', 'sale_void', 'refund', 'purchase_receipt', 'transfer_out', 'transfer_in', 'transfer_return', 'stock_count'];

function HistoryTab() {
  const { branch } = useTenant();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const list = useTenantQuery<Paginated<StockMovement>>('/stock-movements', { branch_id: branch?.id, type, page });
  return (
    <Card padded={false}>
      <div className="border-b border-slate-100 p-4">
        <Select className="max-w-xs" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Movement type">
          <option value="">All movement types</option>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
      </div>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(m) => m.id}
        empty="No movements yet."
        columns={[
          { header: 'When', cell: (m) => formatDateTime(m.created_at) },
          { header: 'Product', cell: (m) => m.product?.name ?? `#${m.product_id}` },
          { header: 'Type', cell: (m) => <Badge>{titleCase(m.type)}</Badge> },
          { header: 'Change', cell: (m) => <span className={Number(m.quantity_change) < 0 ? 'text-red-600' : 'text-emerald-700'}>{Number(m.quantity_change) > 0 ? '+' : ''}{formatQty(m.quantity_change)}</span>, align: 'right' },
          { header: 'Balance', cell: (m) => `${formatQty(m.quantity_before)} → ${formatQty(m.quantity_after)}`, align: 'right' },
          { header: 'Unit cost', cell: (m) => formatMoney(m.unit_cost), align: 'right' },
          { header: 'Reason', cell: (m) => <span className="text-slate-500">{m.reason}</span> },
          { header: 'By', cell: (m) => m.user?.name ?? '—' },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Card>
  );
}

interface CountRecord {
  id: number;
  reference: string;
  branch_id: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  items?: { product_id: number; product: { name: string } | null; counted_quantity: string; expected_quantity: string | null; variance: string | null }[];
}

function CountsTab() {
  const { branch, can } = useTenant();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const list = useTenantQuery<Paginated<CountRecord>>('/stock-counts', { branch_id: branch?.id, page });
  const detail = useTenantQuery<{ data: CountRecord }>(`/stock-counts/${open}`, undefined, { enabled: open !== null });
  const complete = useTenantMutation<number>('POST', (id) => `/stock-counts/${id}/complete`, { success: 'Count completed. Variances posted to stock.' });
  const cancel = useTenantMutation<number>('POST', (id) => `/stock-counts/${id}/cancel`, { success: 'Count cancelled.', onSuccess: () => setOpen(null) });
  const d = detail.data?.data;

  return (
    <Card padded={false}>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(c) => c.id}
        onRowClick={(c) => setOpen(c.id)}
        empty="No stock counts yet."
        columns={[
          { header: 'Reference', cell: (c) => <span className="font-medium">{c.reference}</span> },
          { header: 'Created', cell: (c) => formatDateTime(c.created_at) },
          { header: 'Completed', cell: (c) => formatDateTime(c.completed_at) },
          { header: 'Status', cell: (c) => <Badge status={c.status} /> },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={d ? `Stock count ${d.reference}` : 'Stock count'}
        size="lg"
        footer={
          d?.status === 'draft' && can('inventory.count') ? (
            <>
              <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(d.id)}>Cancel count</Button>
              <Button loading={complete.isPending} onClick={() => complete.mutate(d.id)}>Complete & post variances</Button>
            </>
          ) : undefined
        }
      >
        <DataTable
          rows={d?.items}
          loading={detail.isPending}
          rowKey={(i) => i.product_id}
          columns={[
            { header: 'Product', cell: (i) => i.product?.name ?? i.product_id },
            { header: 'Counted', cell: (i) => formatQty(i.counted_quantity), align: 'right' },
            { header: 'Expected', cell: (i) => (i.expected_quantity === null ? 'at completion' : formatQty(i.expected_quantity)), align: 'right' },
            { header: 'Variance', cell: (i) => (i.variance === null ? '—' : <span className={Number(i.variance) < 0 ? 'text-red-600' : Number(i.variance) > 0 ? 'text-emerald-700' : ''}>{formatQty(i.variance)}</span>), align: 'right' },
          ]}
        />
      </Modal>
    </Card>
  );
}

const REASONS = ['opening', 'damaged', 'expired', 'lost', 'theft', 'found', 'internal_use', 'correction', 'other'];

interface AdjustLine {
  product: Product;
  change: string;
  unitCost: string;
}

function AdjustModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branch } = useTenant();
  const [lines, setLines] = useState<AdjustLine[]>([]);
  const [reason, setReason] = useState('damaged');
  const [notes, setNotes] = useState('');
  const adjust = useTenantMutation<unknown>('POST', '/inventory/adjustments', {
    success: 'Stock adjusted.',
    onSuccess: () => { setLines([]); setNotes(''); onClose(); },
    toastErrors: false,
  });
  const fieldErrors = adjust.error instanceof ApiError ? Object.values(adjust.error.errors).flat() : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust stock — ${branch?.name ?? ''}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={lines.length === 0}
            loading={adjust.isPending}
            onClick={() =>
              adjust.mutate({
                branch_id: branch?.id,
                reason,
                notes: notes || null,
                items: lines.map((l) => ({ product_id: l.product.id, quantity_change: l.change, ...(l.unitCost ? { unit_cost: l.unitCost } : {}) })),
              })
            }
          >
            Post adjustment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Enter the change, not the new balance: <strong>−2</strong> removes two units, <strong>10</strong> adds ten. Stock can never go below zero.</p>
        <ErrorBanner error={adjust.error && fieldErrors.length === 0 ? adjust.error : null} />
        {fieldErrors.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reason">{(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select>}</Field>
          <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional details" />}</Field>
        </div>
        <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, change: '', unitCost: '' }]))} />
        {lines.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="py-1">Change (±)</th>{(reason === 'opening' || reason === 'found') && <th className="py-1">Unit cost</th>}<th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={l.product.id}>
                  <td className="py-2">{l.product.name}</td>
                  <td className="py-2"><Input className="h-8 w-28" inputMode="decimal" value={l.change} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, change: e.target.value } : x)))} aria-label="Quantity change" /></td>
                  {(reason === 'opening' || reason === 'found') && (
                    <td className="py-2"><Input className="h-8 w-28" inputMode="decimal" placeholder="avg cost" value={l.unitCost} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, unitCost: e.target.value } : x)))} aria-label="Unit cost" /></td>
                  )}
                  <td className="py-2 text-right"><button className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

function CountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branch } = useTenant();
  const [lines, setLines] = useState<{ product: Product; counted: string }[]>([]);
  const [notes, setNotes] = useState('');
  const create = useTenantMutation<unknown>('POST', '/stock-counts', {
    success: 'Count saved as draft. Open it in the Counts tab to complete it.',
    onSuccess: () => { setLines([]); setNotes(''); onClose(); },
    toastErrors: false,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New stock count — ${branch?.name ?? ''}`}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={lines.length === 0} loading={create.isPending} onClick={() => create.mutate({ branch_id: branch?.id, notes: notes || null, items: lines.map((l) => ({ product_id: l.product.id, counted_quantity: l.counted })) })}>Save draft</Button></>}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Enter what you physically counted. When the count is completed, the system compares it with the recorded balance and posts the difference.</p>
        <ErrorBanner error={create.error} />
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, counted: '' }]))} />
        {lines.map((l, i) => (
          <div key={l.product.id} className="flex items-center gap-3 text-sm">
            <span className="flex-1">{l.product.name}</span>
            <Input className="h-8 w-28" inputMode="decimal" placeholder="Counted" value={l.counted} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, counted: e.target.value } : x)))} aria-label={`Counted ${l.product.name}`} />
            <button className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
