import { ArrowRight, Ban, Building2, Check, CircleDashed, PackageCheck, Plus, RotateCcw, Truck, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { LineItem, LineList, ProductSearch, QtyInput } from '../../components/ProductSearch';
import { Badge, Button, EmptyState, ErrorBanner, Field, FormSection, Input, LoadingRows, Modal, PageHeader, Pagination, Segmented, Select, cx } from '../../components/ui';
import { formatDateTime, formatQty } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Branch, Paginated, Product, StockTransfer } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';
import { useConfirm } from '../../components/Confirm';

const STATUS_ICON: Record<StockTransfer['status'], { icon: LucideIcon; tile: string }> = {
  draft: { icon: CircleDashed, tile: 'bg-slate-100 text-slate-500' },
  in_transit: { icon: Truck, tile: 'bg-sky-50 text-sky-600' },
  received: { icon: PackageCheck, tile: 'bg-emerald-50 text-emerald-600' },
  cancelled: { icon: Ban, tile: 'bg-rose-50 text-rose-500' },
};

/** "From → To" pair of branch chips. */
function Route({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"><Building2 className="size-3.5 text-slate-400" />{from}</span>
      <ArrowRight className="size-3.5 text-brand-500" />
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-200"><Building2 className="size-3.5 text-brand-500" />{to}</span>
    </span>
  );
}

export function TransfersPage() {
  const { can, branches, allBranches, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useTenantQuery<Paginated<StockTransfer>>('/stock-transfers', { status, page, branch_id: scopeBranchId });
  // All business branches are needed as destinations; members limited to some branches only see theirs.
  const allBranchList = useTenantQuery<{ data: Branch[] }>('/branches');
  const nameOf = (id: number) => (allBranchList.data?.data ?? branches).find((b) => b.id === id)?.name ?? `Branch #${id}`;

  if (!can('inventory.view')) return <NoAccess what="transfers" />;
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Stock transfers"
        description="Move stock between branches. Create a draft, dispatch it (stock leaves the source), then receive it at the destination."
        actions={can('inventory.transfer') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New transfer</Button>}
      />

      {/* How a transfer flows */}
      <ol className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: CircleDashed, title: 'Draft', body: 'Pick products and quantities. Nothing moves yet.' },
          { icon: Truck, title: 'In transit', body: 'Dispatched: stock has left the source branch.' },
          { icon: PackageCheck, title: 'Received', body: 'Destination confirms and the stock is added there.' },
        ].map((s, i) => (
          <li key={s.title} className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
            <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <s.icon className="size-5" />
              <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-sun-400 text-[10px] font-bold text-brand-900 ring-2 ring-white">{i + 1}</span>
            </span>
            <div>
              <p className="font-display text-sm font-semibold text-slate-900">{s.title}</p>
              <p className="text-xs text-slate-500">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'in_transit', label: 'In transit' }, { value: 'received', label: 'Received' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </div>

        {list.error ? (
          <ErrorBanner error={list.error} className="m-4" />
        ) : list.isPending ? (
          <LoadingRows label="Loading transfers" />
        ) : rows.length === 0 ? (
          <EmptyState icon={Truck} title={status ? 'No transfers with this status' : 'No transfers yet'}
            description={status ? 'Pick another status to see more.' : 'Send stock from one branch to another to balance inventory.'}
            action={status
              ? <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => setStatus('')}>Show all</Button>
              : can('inventory.transfer') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New transfer</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((t) => {
              const s = STATUS_ICON[t.status] ?? STATUS_ICON.draft;
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setOpen(t.id)} className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none">
                    <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', s.tile)}><s.icon className="size-5" /></span>
                    <span className="min-w-36">
                      <span className="block font-mono text-sm font-medium text-slate-900">{t.reference}</span>
                      <span className="block text-xs text-slate-400">{formatDateTime(t.created_at)}</span>
                    </span>
                    <span className="flex-1"><Route from={nameOf(t.from_branch_id)} to={nameOf(t.to_branch_id)} /></span>
                    <Badge status={t.status} />
                    <ArrowRight className="size-4 -translate-x-1 text-slate-300 opacity-0 transition group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>
      <TransferDetail id={open} onClose={() => setOpen(null)} nameOf={nameOf} />
      <CreateTransfer open={creating} onClose={() => setCreating(false)} destinations={allBranchList.data?.data ?? branches} restricted={!allBranches} />
    </>
  );
}

/** Draft → In transit → Received progress, or a cancelled banner. */
function Stepper({ status }: { status: StockTransfer['status'] }) {
  if (status === 'cancelled') {
    return <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-100"><Ban className="size-4" /> This transfer was cancelled. Any dispatched stock returned to the source.</div>;
  }
  const steps = ['draft', 'in_transit', 'received'] as const;
  const at = steps.indexOf(status);
  return (
    <ol className="flex items-center">
      {steps.map((s, i) => (
        <li key={s} className={cx('flex items-center', i < steps.length - 1 && 'flex-1')}>
          <span className="flex items-center gap-2">
            <span className={cx('grid size-7 place-items-center rounded-full text-xs font-bold transition', i < at ? 'bg-brand-600 text-white' : i === at ? 'bg-sun-400 text-brand-900 ring-4 ring-sun-300/40' : 'bg-slate-100 text-slate-400')}>
              {i < at ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cx('whitespace-nowrap text-xs font-semibold', i <= at ? 'text-slate-900' : 'text-slate-400')}>{s === 'in_transit' ? 'In transit' : s === 'draft' ? 'Draft' : 'Received'}</span>
          </span>
          {i < steps.length - 1 && <span className={cx('mx-3 h-0.5 flex-1 rounded-full', i < at ? 'bg-brand-500' : 'bg-slate-200')} />}
        </li>
      ))}
    </ol>
  );
}

function TransferDetail({ id, onClose, nameOf }: { id: number | null; onClose: () => void; nameOf: (id: number) => string }) {
  const ask = useConfirm();
  const { can, branches } = useTenant();
  const detail = useTenantQuery<{ data: StockTransfer }>(`/stock-transfers/${id}`, undefined, { enabled: id !== null });
  const action = useTenantMutation<{ id: number; action: 'dispatch' | 'receive' | 'cancel' }>('POST', (b) => `/stock-transfers/${b.id}/${b.action}`, { success: 'Transfer updated.' });
  const t = detail.data?.data;
  const atSource = !!t && branches.some((b) => b.id === t.from_branch_id);
  const atDestination = !!t && branches.some((b) => b.id === t.to_branch_id);
  const units = (t?.items ?? []).reduce((s, i) => s + Number(i.quantity), 0);

  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={t ? `Transfer ${t.reference}` : 'Transfer'}
      description={t ? `Created ${formatDateTime(t.created_at)}` : undefined}
      icon={Truck}
      size="lg"
      footer={
        t && can('inventory.transfer') ? (
          <>
            {t.status === 'draft' && atSource && <Button variant="secondary" onClick={() => action.mutate({ id: t.id, action: 'cancel' })}>Cancel transfer</Button>}
            {t.status === 'draft' && atSource && <Button icon={<Truck className="size-4" />} loading={action.isPending} onClick={() => action.mutate({ id: t.id, action: 'dispatch' })}>Dispatch</Button>}
            {t.status === 'in_transit' && atSource && <Button variant="secondary" onClick={async () => { if (await ask({ title: 'Cancel this transfer?', message: 'The stock goes back to the source branch.', confirmLabel: 'Cancel transfer', cancelLabel: 'Keep it' })) action.mutate({ id: t.id, action: 'cancel' }); }}>Cancel & return stock</Button>}
            {t.status === 'in_transit' && atDestination && <Button icon={<PackageCheck className="size-4" />} loading={action.isPending} onClick={() => action.mutate({ id: t.id, action: 'receive' })}>Receive all</Button>}
          </>
        ) : undefined
      }
    >
      {!t ? (
        detail.error ? <ErrorBanner error={detail.error} /> : <LoadingRows rows={3} />
      ) : (
        <div className="space-y-5">
          <Stepper status={t.status} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
            <Route from={nameOf(t.from_branch_id)} to={nameOf(t.to_branch_id)} />
            <span className="text-xs text-slate-500"><strong className="text-slate-900">{t.items?.length ?? 0}</strong> products · <strong className="text-slate-900">{formatQty(String(units))}</strong> units</span>
          </div>
          {t.notes && <p className="rounded-xl bg-cream/60 px-3 py-2 text-sm text-slate-700 ring-1 ring-sun-300/40">“{t.notes}”</p>}
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-4 py-2 text-left font-semibold">Product</th><th className="px-4 py-2 text-right font-semibold">Sent</th><th className="px-4 py-2 text-left font-semibold">Received</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(t.items ?? []).map((i) => {
                  const pct = Number(i.quantity) > 0 ? Math.min(100, (Number(i.quantity_received) / Number(i.quantity)) * 100) : 0;
                  return (
                    <tr key={i.id}>
                      <td className="px-4 py-2.5"><span className="block font-medium text-slate-900">{i.product?.name ?? `#${i.product_id}`}</span>{i.product?.sku && <span className="font-mono text-[11px] text-slate-400">{i.product.sku}</span>}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(i.quantity)} <span className="text-xs text-slate-400">{i.product?.unit}</span></td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><span className={cx('block h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} /></span>
                          <span className="text-xs tabular-nums text-slate-600">{formatQty(i.quantity_received)}</span>
                        </span>
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
  );
}

function CreateTransfer({ open, onClose, destinations, restricted }: { open: boolean; onClose: () => void; destinations: Branch[]; restricted: boolean }) {
  const { branches, branch } = useTenant();
  const [from, setFrom] = useState<number | ''>(branch?.id ?? '');
  const [to, setTo] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ product: Product; quantity: string }[]>([]);
  const create = useTenantMutation<unknown>('POST', '/stock-transfers', {
    success: 'Transfer created as draft. Dispatch it to move the stock.',
    onSuccess: () => { setLines([]); setNotes(''); onClose(); },
    toastErrors: false,
  });
  const ready = !!from && !!to && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New stock transfer"
      description="Saved as a draft. Nothing moves until you dispatch it."
      icon={Truck}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ready} loading={create.isPending} onClick={() => create.mutate({ from_branch_id: from, to_branch_id: to, notes: notes || null, items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })) })}>Create transfer</Button></>}
    >
      <div className="space-y-6">
        <ErrorBanner error={create.error} />
        <FormSection title="Route">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Field label="From branch">{(id) => <Select id={id} value={from} onChange={(e) => setFrom(Number(e.target.value))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
            <span className="hidden size-10 place-items-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100 sm:grid"><ArrowRight className="size-4" /></span>
            <Field label="To branch" hint={restricted ? 'Only branches you can see are listed.' : undefined}>
              {(id) => <Select id={id} value={to} onChange={(e) => setTo(Number(e.target.value))}><option value="">Choose…</option>{destinations.filter((b) => b.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
            </Field>
          </div>
          <Field label="Notes">{(id) => <Input id={id} value={notes} placeholder="Optional, e.g. restock for weekend" onChange={(e) => setNotes(e.target.value)} />}</Field>
        </FormSection>
        <FormSection title="Products">
          <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: '' }]))} />
          <LineList count={lines.length} empty="Search above to add the products you're sending.">
            {lines.map((l, i) => (
              <LineItem key={l.product.id} name={l.product.name} sku={l.product.sku} onRemove={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                <QtyInput label={`Quantity ${l.product.name}`} suffix={l.product.unit} value={l.quantity} onChange={(v) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, quantity: v } : x)))} />
              </LineItem>
            ))}
          </LineList>
        </FormSection>
      </div>
    </Modal>
  );
}
