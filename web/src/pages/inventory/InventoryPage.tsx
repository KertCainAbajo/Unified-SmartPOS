import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  History,
  Info,
  Package,
  PackageCheck,
  RotateCcw,
  ShoppingCart,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { LineItem, LineList, ProductSearch, QtyInput } from '../../components/ProductSearch';
import { BranchTag } from '../../components/BranchSwitcher';
import { Avatar, Badge, Button, EmptyState, ErrorBanner, Field, FormSection, Input, LoadingRows, Modal, PageHeader, Pagination, SearchField, Select, StatCard, Tabs, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatMoney, formatQty, titleCase } from '../../lib/format';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { InventoryRow, Paginated, Product, StockMovement } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

type Tab = 'stock' | 'low' | 'history' | 'counts';
const totalOf = (p?: { meta?: { total: number }; total?: number; data: unknown[] }) => (p ? p.meta?.total ?? p.total ?? p.data.length : null);

export function InventoryPage() {
  const { can, branch, branches, viewAll, scopeBranchId } = useTenant();
  const scopeName = viewAll ? `all ${branches.length} branches` : branch?.name ?? 'your branch';
  const [tab, setTab] = useState<Tab>('stock');
  const [adjusting, setAdjusting] = useState(false);
  const [counting, setCounting] = useState(false);
  const tracked = useTenantQuery<Paginated<InventoryRow>>('/inventory', { branch_id: scopeBranchId, per_page: 1 }, { enabled: can('inventory.view') });
  const low = useTenantQuery<Paginated<InventoryRow>>('/inventory/low-stock', { branch_id: scopeBranchId, per_page: 1 }, { enabled: can('inventory.view') });
  const drafts = useTenantQuery<Paginated<CountRecord>>('/stock-counts', { branch_id: scopeBranchId, status: 'draft', per_page: 1 }, { enabled: can('inventory.view') });

  if (!can('inventory.view')) return <NoAccess what="inventory" />;
  const lowCount = totalOf(low.data);
  const draftCount = totalOf(drafts.data);

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Inventory"
        description={<>Stock at <strong className="font-semibold text-slate-700">{scopeName}</strong>. Balances change only through recorded movements.</>}
        actions={
          <>
            {can('inventory.count') && <Button variant="secondary" icon={<ClipboardCheck className="size-4" />} onClick={() => setCounting(true)}>Stock count</Button>}
            {can('inventory.adjust') && <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting(true)}>Adjust stock</Button>}
          </>
        }
      />

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard tone="featured" icon={Boxes} label="Products tracked" value={totalOf(tracked.data)} hint={viewAll ? 'Product × branch records' : `At ${scopeName}`} />
        <StatCard tone={lowCount ? 'warn' : 'brand'} icon={lowCount ? AlertTriangle : PackageCheck} label="Below reorder level" value={lowCount} hint={lowCount ? 'Time to reorder' : 'Everything is well stocked'} />
        <StatCard tone="sky" icon={ClipboardList} label="Counts in progress" value={draftCount} hint={draftCount ? 'Drafts waiting to be completed' : 'No open counts'} />
      </section>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'stock', label: 'Stock on hand', icon: Boxes },
        { value: 'low', label: 'Low stock', icon: AlertTriangle, count: lowCount ?? undefined },
        { value: 'history', label: 'History', icon: History },
        { value: 'counts', label: 'Counts', icon: ClipboardList, count: draftCount ?? undefined },
      ]} />
      <div key={tab} className="auth-fade">
        {tab === 'stock' && <StockTab />}
        {tab === 'low' && <LowStockTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'counts' && <CountsTab />}
      </div>
      <AdjustModal open={adjusting} onClose={() => setAdjusting(false)} />
      <CountModal open={counting} onClose={() => setCounting(false)} />
    </>
  );
}

const Panel = ({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) => (
  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
    {toolbar && <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">{toolbar}</div>}
    {children}
  </section>
);

const Th = ({ children, right, first }: { children?: ReactNode; right?: boolean; first?: boolean }) => (
  <th scope="col" className={cx('py-3 font-semibold', right ? 'text-right' : 'text-left', first ? 'pl-5 pr-3' : 'px-3 last:pr-5')}>{children}</th>
);

function ProductCell({ name, sku }: { name: string; sku?: string }) {
  return (
    <span className="flex items-center gap-3">
      <Avatar name={name} square size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-slate-900">{name}</span>
        {sku && <span className="block font-mono text-[11px] text-slate-400">{sku}</span>}
      </span>
    </span>
  );
}

function stockLevel(qty: number, reorder: number) {
  if (qty <= 0) return { label: 'Out of stock', pill: 'bg-rose-50 text-rose-700 ring-rose-600/20', dot: 'bg-rose-500', bar: 'bg-rose-500' };
  if (qty <= reorder) return { label: 'Low', pill: 'bg-amber-50 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500', bar: 'bg-amber-500' };
  return { label: 'Healthy', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500', bar: 'bg-emerald-500' };
}

function LevelPill({ qty, reorder }: { qty: number; reorder: number }) {
  const l = stockLevel(qty, reorder);
  return <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', l.pill)}><span className={cx('size-1.5 rounded-full', l.dot)} />{l.label}</span>;
}

function StockTab() {
  const { viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const q = useDebounced(term);
  const list = useTenantQuery<Paginated<InventoryRow>>('/inventory', { branch_id: scopeBranchId, q: q || undefined, page });
  const rows = list.data?.data ?? [];

  return (
    <Panel toolbar={<SearchField className="sm:w-80" value={term} onChange={(v) => { setTerm(v); setPage(1); }} placeholder="Search product or SKU" />}>
      {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading stock" /> : rows.length === 0 ? (
        <EmptyState icon={Package} title={term ? 'No products match' : 'No stock records yet'} description={term ? 'Try another name or SKU.' : 'Record opening stock with Adjust stock to start tracking this branch.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400"><Th first>Product</Th>{viewAll && <Th>Branch</Th>}<Th right>On hand</Th><Th>Level</Th><Th right>Reorder at</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const qty = Number(r.quantity);
                const reorder = Number(r.reorder_level);
                const level = stockLevel(qty, reorder);
                const pct = Math.max(0, Math.min(100, (qty / Math.max(reorder * 2, 1)) * 100));
                return (
                  <tr key={`${r.branch_id}-${r.product_id}`} className="transition-colors hover:bg-brand-50/40">
                    <td className="py-3 pl-5 pr-3"><ProductCell name={r.name} sku={r.sku} /></td>
                    {viewAll && <td className="px-3 py-3"><BranchTag id={r.branch_id} /></td>}
                    <td className="px-3 py-3 text-right">
                      <span className={cx('font-display font-semibold tabular-nums', qty < 0 ? 'text-rose-600' : 'text-slate-900')}>{formatQty(r.quantity)}</span>
                      <span className="ml-1 text-xs text-slate-400">{r.unit}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block h-1.5 w-28 overflow-hidden rounded-full bg-slate-100" title={`${formatQty(r.quantity)} of a comfortable ${formatQty(String(reorder * 2))}`}>
                        <span className={cx('block h-full rounded-full transition-[width] duration-500', level.bar)} style={{ width: `${pct}%` }} />
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{formatQty(r.reorder_level)}</td>
                    <td className="px-3 py-3 pr-5"><LevelPill qty={qty} reorder={reorder} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Panel>
  );
}

function LowStockTab() {
  const { viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const list = useTenantQuery<Paginated<{ branch_id: number; product_id: number; sku: string; name: string; unit: string; quantity: string; reorder_level: string }>>('/inventory/low-stock', { branch_id: scopeBranchId, page });
  const rows = list.data?.data ?? [];

  return (
    <Panel>
      {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading low stock" /> : rows.length === 0 ? (
        <EmptyState icon={PackageCheck} title="All stocked up" description="Nothing is below its reorder level at this branch." />
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-5 py-3 text-sm text-amber-900">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            These products are at or below their reorder level. Create a purchase order or transfer to restock.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400"><Th first>Product</Th>{viewAll && <Th>Branch</Th>}<Th right>On hand</Th><Th right>Reorder at</Th><Th right>Short by</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const qty = Number(r.quantity);
                  const reorder = Number(r.reorder_level);
                  return (
                    <tr key={`${r.branch_id}-${r.product_id}`} className="transition-colors hover:bg-amber-50/40">
                      <td className="py-3 pl-5 pr-3"><ProductCell name={r.name} sku={r.sku} /></td>
                      {viewAll && <td className="px-3 py-3"><BranchTag id={r.branch_id} /></td>}
                      <td className="px-3 py-3 text-right"><span className={cx('font-display font-semibold tabular-nums', qty <= 0 ? 'text-rose-600' : 'text-amber-700')}>{formatQty(r.quantity)}</span> <span className="text-xs text-slate-400">{r.unit}</span></td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-500">{formatQty(r.reorder_level)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-700">{formatQty(String(Math.max(0, reorder - qty)))}</td>
                      <td className="px-3 py-3 pr-5"><LevelPill qty={qty} reorder={reorder} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Panel>
  );
}

const MOVEMENT_TYPES = ['opening', 'adjustment', 'sale', 'sale_void', 'refund', 'purchase_receipt', 'transfer_out', 'transfer_in', 'transfer_return', 'stock_count'];

const MOVEMENT_STYLE: Record<string, { icon: LucideIcon; chip: string }> = {
  opening: { icon: Package, chip: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
  adjustment: { icon: SlidersHorizontal, chip: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
  sale: { icon: ShoppingCart, chip: 'bg-brand-50 text-brand-700 ring-brand-600/20' },
  sale_void: { icon: RotateCcw, chip: 'bg-rose-50 text-rose-700 ring-rose-600/20' },
  refund: { icon: RotateCcw, chip: 'bg-rose-50 text-rose-700 ring-rose-600/20' },
  purchase_receipt: { icon: PackageCheck, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  transfer_out: { icon: ArrowUpRight, chip: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  transfer_in: { icon: ArrowDownLeft, chip: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  transfer_return: { icon: ArrowLeftRight, chip: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  stock_count: { icon: ClipboardCheck, chip: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
};

function HistoryTab() {
  const { viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const list = useTenantQuery<Paginated<StockMovement>>('/stock-movements', { branch_id: scopeBranchId, type, page });
  const rows = list.data?.data ?? [];

  return (
    <Panel toolbar={
      <Select className="h-10 sm:w-64" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Movement type">
        <option value="">All movement types</option>
        {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
      </Select>
    }>
      {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading movements" /> : rows.length === 0 ? (
        <EmptyState icon={History} title="No movements yet" description={type ? 'No movements of this type at this branch.' : 'Sales, receipts, transfers and adjustments will be listed here.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400"><Th first>Movement</Th><Th>Product</Th><Th right>Change</Th><Th right>Balance</Th><Th right>Unit cost</Th><Th>By</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => {
                const s = MOVEMENT_STYLE[m.type] ?? MOVEMENT_STYLE.adjustment;
                const change = Number(m.quantity_change);
                return (
                  <tr key={m.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="py-3 pl-5 pr-3">
                      <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.chip)}><s.icon className="size-3.5" />{titleCase(m.type)}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">{formatDateTime(m.created_at)}{viewAll && <BranchTag id={m.branch_id} />}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block font-medium text-slate-900">{m.product?.name ?? `#${m.product_id}`}</span>
                      {m.reason && <span className="block max-w-56 truncate text-xs text-slate-400" title={m.reason}>{m.reason}</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cx('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-display text-sm font-semibold tabular-nums', change < 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700')}>
                        {change < 0 ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}{change > 0 ? '+' : ''}{formatQty(m.quantity_change)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-500">{formatQty(m.quantity_before)} <span className="text-slate-300">→</span> <strong className="font-semibold text-slate-900">{formatQty(m.quantity_after)}</strong></td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{m.unit_cost ? formatMoney(m.unit_cost) : '—'}</td>
                    <td className="px-3 py-3 pr-5">{m.user?.name ? <span className="inline-flex items-center gap-2 whitespace-nowrap"><Avatar name={m.user.name} size="sm" /><span className="text-slate-600">{m.user.name}</span></span> : <span className="text-slate-300">System</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} data={list.data} onPage={setPage} />
    </Panel>
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
  const { can, viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const list = useTenantQuery<Paginated<CountRecord>>('/stock-counts', { branch_id: scopeBranchId, page });
  const detail = useTenantQuery<{ data: CountRecord }>(`/stock-counts/${open}`, undefined, { enabled: open !== null });
  const complete = useTenantMutation<number>('POST', (id) => `/stock-counts/${id}/complete`, { success: 'Count completed. Variances posted to stock.' });
  const cancel = useTenantMutation<number>('POST', (id) => `/stock-counts/${id}/cancel`, { success: 'Count cancelled.', onSuccess: () => setOpen(null) });
  const d = detail.data?.data;
  const rows = list.data?.data ?? [];
  const variance = (d?.items ?? []).reduce((s, i) => s + Number(i.variance ?? 0), 0);

  return (
    <Panel>
      {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading counts" /> : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No stock counts yet" description="Use Stock count to record what's physically on the shelf and reconcile it with the system." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(c.id)} className="group flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-left transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none">
                <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', c.status === 'draft' ? 'bg-amber-50 text-amber-600' : c.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}><ClipboardCheck className="size-5" /></span>
                <span className="min-w-36 flex-1">
                  <span className="block font-mono text-sm font-medium text-slate-900">{c.reference}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">{viewAll && <BranchTag id={c.branch_id} />}Started {formatDateTime(c.created_at)}{c.completed_at && <> · completed {formatDateTime(c.completed_at)}</>}</span>
                </span>
                <Badge status={c.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} data={list.data} onPage={setPage} />
      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={d ? `Stock count ${d.reference}` : 'Stock count'}
        description={d ? `Started ${formatDateTime(d.created_at)}` : undefined}
        icon={ClipboardCheck}
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
        {!d ? <LoadingRows rows={3} /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <Badge status={d.status} />
              <span className="text-xs text-slate-500">
                <strong className="text-slate-900">{d.items?.length ?? 0}</strong> products counted
                {d.status !== 'draft' && <> · net variance <strong className={cx(variance < 0 ? 'text-rose-600' : variance > 0 ? 'text-emerald-700' : 'text-slate-900')}>{variance > 0 ? '+' : ''}{formatQty(String(variance))}</strong></>}
              </span>
            </div>
            {d.status === 'draft' && <p className="flex items-start gap-2 text-xs text-slate-500"><Info className="mt-0.5 size-3.5 shrink-0 text-brand-600" />Expected quantities are taken when you complete the count, so sales made meanwhile are accounted for.</p>}
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-4 py-2 text-left font-semibold">Product</th><th className="px-4 py-2 text-right font-semibold">Counted</th><th className="px-4 py-2 text-right font-semibold">Expected</th><th className="px-4 py-2 text-right font-semibold">Variance</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(d.items ?? []).map((i) => {
                    const v = Number(i.variance ?? 0);
                    return (
                      <tr key={i.product_id}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{i.product?.name ?? `#${i.product_id}`}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(i.counted_quantity)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{i.expected_quantity === null ? <span className="text-xs italic text-slate-400">at completion</span> : formatQty(i.expected_quantity)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {i.variance === null ? <span className="text-slate-300">—</span> : (
                            <span className={cx('rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums', v < 0 ? 'bg-rose-50 text-rose-600' : v > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{v > 0 ? '+' : ''}{formatQty(i.variance)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </Panel>
  );
}

const REASONS = ['opening', 'damaged', 'expired', 'lost', 'theft', 'found', 'internal_use', 'correction', 'other'];

interface AdjustLine {
  product: Product;
  change: string;
  unitCost: string;
}

function AdjustModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branch: working, branches, branchName } = useTenant();
  const [branchId, setBranchId] = useState<number | undefined>(working?.id);
  const branch = branches.find((b) => b.id === (branchId ?? working?.id)) ?? working;
  const [lines, setLines] = useState<AdjustLine[]>([]);
  const [reason, setReason] = useState('damaged');
  const [notes, setNotes] = useState('');
  const adjust = useTenantMutation<unknown>('POST', '/inventory/adjustments', {
    success: 'Stock adjusted.',
    onSuccess: () => { setLines([]); setNotes(''); onClose(); },
    toastErrors: false,
  });
  const fieldErrors = adjust.error instanceof ApiError ? Object.values(adjust.error.errors).flat() : [];
  const withCost = reason === 'opening' || reason === 'found';
  const update = (i: number, patch: Partial<AdjustLine>) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const added = lines.reduce((s, l) => s + Math.max(0, Number(l.change) || 0), 0);
  const removed = lines.reduce((s, l) => s + Math.min(0, Number(l.change) || 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust stock"
      description={`Posting to ${branchName(branch?.id)}`}
      icon={SlidersHorizontal}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={lines.length === 0 || lines.some((l) => !Number(l.change))}
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
      <div className="space-y-6">
        <p className="flex items-start gap-2 rounded-xl bg-brand-50/60 p-3 text-sm text-slate-700 ring-1 ring-brand-100">
          <Info className="mt-0.5 size-4 shrink-0 text-brand-600" />
          <span>Enter the <strong>change</strong>, not the new balance: <strong>−2</strong> removes two units, <strong>10</strong> adds ten. Stock can never go below zero.</span>
        </p>
        <ErrorBanner error={adjust.error && fieldErrors.length === 0 ? adjust.error : null} />
        {fieldErrors.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
        <FormSection title="Reason">
          {branches.length > 1 && <Field label="Branch">{(id) => <Select id={id} value={branch?.id ?? ''} onChange={(e) => setBranchId(Number(e.target.value))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reason">{(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select>}</Field>
            <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional details" />}</Field>
          </div>
        </FormSection>
        <FormSection title="Products">
          <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, change: '', unitCost: '' }]))} />
          <LineList count={lines.length} empty="Search above to add the products to adjust."
            header={<span className="normal-case tracking-normal"><span className="text-emerald-700">+{formatQty(String(added))}</span> / <span className="text-rose-600">{formatQty(String(removed))}</span></span>}>
            {lines.map((l, i) => (
              <LineItem key={l.product.id} name={l.product.name} sku={l.product.sku} onRemove={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                <QtyInput label={`Quantity change ${l.product.name}`} placeholder="±0" suffix={l.product.unit} value={l.change} onChange={(v) => update(i, { change: v.replace(/[^\d.-]/g, '') })} />
                {withCost && <QtyInput label={`Unit cost ${l.product.name}`} prefix="₱" placeholder="avg cost" value={l.unitCost} onChange={(v) => update(i, { unitCost: v })} />}
              </LineItem>
            ))}
          </LineList>
        </FormSection>
      </div>
    </Modal>
  );
}

function CountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branch: working, branches, branchName } = useTenant();
  const [branchId, setBranchId] = useState<number | undefined>(working?.id);
  const branch = branches.find((b) => b.id === (branchId ?? working?.id)) ?? working;
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
      title="New stock count"
      description={`Counting at ${branchName(branch?.id)}`}
      icon={ClipboardCheck}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={lines.length === 0 || lines.some((l) => l.counted === '')} loading={create.isPending} onClick={() => create.mutate({ branch_id: branch?.id, notes: notes || null, items: lines.map((l) => ({ product_id: l.product.id, counted_quantity: l.counted })) })}>Save draft</Button></>}
    >
      <div className="space-y-6">
        <p className="flex items-start gap-2 rounded-xl bg-brand-50/60 p-3 text-sm text-slate-700 ring-1 ring-brand-100">
          <Info className="mt-0.5 size-4 shrink-0 text-brand-600" />
          Enter what you physically counted. When the count is completed, the system compares it with the recorded balance and posts the difference.
        </p>
        <ErrorBanner error={create.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          {branches.length > 1 && <Field label="Branch">{(id) => <Select id={id} value={branch?.id ?? ''} onChange={(e) => setBranchId(Number(e.target.value))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
          <Field label="Notes" className={branches.length > 1 ? undefined : 'sm:col-span-2'}>{(id) => <Input id={id} value={notes} placeholder="Optional, e.g. aisle 3 shelf audit" onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
        <FormSection title="Products counted">
          <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, counted: '' }]))} />
          <LineList count={lines.length} empty="Search above, then type the quantity you counted.">
            {lines.map((l, i) => (
              <LineItem key={l.product.id} name={l.product.name} sku={l.product.sku} onRemove={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                <QtyInput label={`Counted ${l.product.name}`} suffix={l.product.unit} value={l.counted} onChange={(v) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, counted: v } : x)))} />
              </LineItem>
            ))}
          </LineList>
        </FormSection>
      </div>
    </Modal>
  );
}

