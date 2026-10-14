import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ProductSearch } from '../../components/ProductSearch';
import { Badge, Button, Card, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select } from '../../components/ui';
import { formatDateTime, formatQty } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Branch, Paginated, Product, StockTransfer } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function TransfersPage() {
  const { can, branches, allBranches } = useTenant();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useTenantQuery<Paginated<StockTransfer>>('/stock-transfers', { status, page });
  // All business branches are needed as destinations; members limited to some branches only see theirs.
  const allBranchList = useTenantQuery<{ data: Branch[] }>('/branches');
  const nameOf = (id: number) => (allBranchList.data?.data ?? branches).find((b) => b.id === id)?.name ?? `Branch #${id}`;

  if (!can('inventory.view')) return <NoAccess what="transfers" />;

  return (
    <>
      <PageHeader
        title="Stock transfers"
        description="Move stock between branches: create → dispatch (leaves source) → receive (arrives at destination)."
        actions={can('inventory.transfer') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New transfer</Button>}
      />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <Select className="max-w-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="in_transit">In transit</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(t) => t.id}
          onRowClick={(t) => setOpen(t.id)}
          empty="No transfers yet."
          columns={[
            { header: 'Reference', cell: (t) => <span className="font-medium">{t.reference}</span> },
            { header: 'From', cell: (t) => nameOf(t.from_branch_id) },
            { header: 'To', cell: (t) => nameOf(t.to_branch_id) },
            { header: 'Created', cell: (t) => formatDateTime(t.created_at) },
            { header: 'Status', cell: (t) => <Badge status={t.status} /> },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>
      <TransferDetail id={open} onClose={() => setOpen(null)} nameOf={nameOf} />
      <CreateTransfer open={creating} onClose={() => setCreating(false)} destinations={allBranchList.data?.data ?? branches} restricted={!allBranches} />
    </>
  );
}

function TransferDetail({ id, onClose, nameOf }: { id: number | null; onClose: () => void; nameOf: (id: number) => string }) {
  const { can, branches } = useTenant();
  const detail = useTenantQuery<{ data: StockTransfer }>(`/stock-transfers/${id}`, undefined, { enabled: id !== null });
  const action = useTenantMutation<{ id: number; action: 'dispatch' | 'receive' | 'cancel' }>('POST', (b) => `/stock-transfers/${b.id}/${b.action}`, { success: 'Transfer updated.' });
  const t = detail.data?.data;
  const atSource = !!t && branches.some((b) => b.id === t.from_branch_id);
  const atDestination = !!t && branches.some((b) => b.id === t.to_branch_id);

  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={t ? `${t.reference} · ${nameOf(t.from_branch_id)} → ${nameOf(t.to_branch_id)}` : 'Transfer'}
      size="lg"
      footer={
        t && can('inventory.transfer') ? (
          <>
            {t.status === 'draft' && atSource && <Button variant="secondary" onClick={() => action.mutate({ id: t.id, action: 'cancel' })}>Cancel transfer</Button>}
            {t.status === 'draft' && atSource && <Button loading={action.isPending} onClick={() => action.mutate({ id: t.id, action: 'dispatch' })}>Dispatch</Button>}
            {t.status === 'in_transit' && atSource && <Button variant="secondary" onClick={() => confirm('Cancel this transfer and return the stock to the source branch?') && action.mutate({ id: t.id, action: 'cancel' })}>Cancel & return stock</Button>}
            {t.status === 'in_transit' && atDestination && <Button loading={action.isPending} onClick={() => action.mutate({ id: t.id, action: 'receive' })}>Receive all</Button>}
          </>
        ) : undefined
      }
    >
      {t && <p className="mb-3"><Badge status={t.status} /> {t.notes && <span className="ml-2 text-sm text-slate-500">{t.notes}</span>}</p>}
      <DataTable
        rows={t?.items}
        loading={detail.isPending}
        rowKey={(i) => i.id}
        columns={[
          { header: 'Product', cell: (i) => i.product?.name ?? i.product_id },
          { header: 'Quantity', cell: (i) => formatQty(i.quantity), align: 'right' },
          { header: 'Received', cell: (i) => formatQty(i.quantity_received), align: 'right' },
        ]}
      />
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New stock transfer"
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!from || !to || lines.length === 0} loading={create.isPending} onClick={() => create.mutate({ from_branch_id: from, to_branch_id: to, notes: notes || null, items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })) })}>Create transfer</Button></>}
    >
      <div className="space-y-4">
        <ErrorBanner error={create.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From branch">{(id) => <Select id={id} value={from} onChange={(e) => setFrom(Number(e.target.value))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
          <Field label="To branch" hint={restricted ? 'Only branches you can see are listed.' : undefined}>
            {(id) => <Select id={id} value={to} onChange={(e) => setTo(Number(e.target.value))}><option value="">Choose…</option>{destinations.filter((b) => b.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
          </Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <ProductSearch onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: '' }]))} />
        {lines.map((l, i) => (
          <div key={l.product.id} className="flex items-center gap-3 text-sm">
            <span className="flex-1">{l.product.name}</span>
            <Input className="h-8 w-28" inputMode="decimal" placeholder="Qty" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} aria-label={`Quantity ${l.product.name}`} />
            <button className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
