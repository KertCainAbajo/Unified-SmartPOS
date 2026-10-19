import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ClipboardList, PackageCheck, PackagePlus, Store, Truck, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { Button, ErrorBanner, Field, Input, Modal, Select, Switch, cx } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatMoney, formatQty } from '../../lib/format';
import { useTenantQuery } from '../../lib/hooks';
import type { Paginated, Product, Supplier } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';

/** A product that needs stock at a branch (from the low-stock list). */
export interface RestockItem {
  branch_id: number;
  product_id: number;
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  reorder_level: string;
}

type Method = 'receive' | 'order' | 'transfer';
type Target = 'reorder' | 'double';

/** Units needed to reach the target level, rounded up to whole units; 0 when the branch already has enough. */
const suggest = (item: RestockItem, target: Target) => {
  const reorder = Number(item.reorder_level);
  const goal = target === 'double' ? Math.max(reorder * 2, reorder + 1) : reorder + 1;
  return Math.max(Math.ceil(goal - Number(item.quantity)), 0);
};

/**
 * One-step restocking from the low-stock list: pick how the stock comes in (a delivery that just arrived, an order
 * to a supplier, or a transfer from another branch); quantities are pre-filled to bring each product back above its
 * reorder level.
 */
export function RestockModal({ items: pickedItems, open, onClose, onDone }: { items: RestockItem[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const { can, branches, branchName, path, tenantId } = useTenant();
  const toast = useToast();
  const queryClient = useQueryClient();
  // The branch being restocked: starts as the branch the products were picked at, and can be changed.
  const [branchId, setBranchId] = useState<number | undefined>(pickedItems[0]?.branch_id);

  const methods: { value: Method; title: string; body: string; icon: LucideIcon }[] = [
    ...(can('purchasing.receive') ? [{ value: 'receive' as Method, title: 'Delivery arrived', body: 'Add the stock now. Use this when the goods are already here.', icon: PackageCheck }] : []),
    ...(can('purchasing.manage') ? [{ value: 'order' as Method, title: 'Order from supplier', body: 'Create a purchase order, then receive it when it arrives.', icon: ClipboardList }] : []),
    ...(can('inventory.transfer') && branches.length > 1 ? [{ value: 'transfer' as Method, title: 'Move from a branch', body: 'Transfer stock from another branch that has extra.', icon: Truck }] : []),
  ];

  const [method, setMethod] = useState<Method>('receive');
  const [target, setTarget] = useState<Target>('double');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [cost, setCost] = useState<Record<number, string>>({});
  const [supplierId, setSupplierId] = useState('');
  const [invoice, setInvoice] = useState('');
  const [fromBranch, setFromBranch] = useState<number | ''>('');
  const [finishNow, setFinishNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const products = useTenantQuery<Paginated<Product>>('/products', { with_stock: 1, per_page: 100 }, { enabled: open });
  const suppliers = useTenantQuery<Paginated<Supplier>>('/suppliers', { active_only: 1, per_page: 100 }, { enabled: open && method !== 'transfer' });
  const productOf = (id: number) => products.data?.data.find((p) => p.id === id);
  const stockAt = (productId: number, branch: number | '') => Number(productOf(productId)?.stock?.find((s) => s.branch_id === branch)?.quantity ?? 0);

  /** The picked products as they stand at the chosen branch (its own on-hand quantities). */
  const items = useMemo(
    () => pickedItems.map((i) => (i.branch_id === branchId || branchId === undefined ? i : { ...i, branch_id: branchId, quantity: String(stockAt(i.product_id, branchId)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickedItems, branchId, products.data],
  );

  // Reset when opened with a new selection.
  useEffect(() => {
    if (!open) return;
    setBranchId(pickedItems[0]?.branch_id);
    setMethod(methods[0]?.value ?? 'receive');
    setTarget('double');
    setCost({});
    setInvoice('');
    setError(null);
    setFinishNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pickedItems]);

  // Suggested quantities follow the chosen branch's stock; a transfer source must be a different branch.
  useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(items.map((i) => [i.product_id, String(suggest(i, target))])));
    setFromBranch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId, products.data]);

  // Default costs from the product's average cost once products load.
  useEffect(() => {
    if (!products.data) return;
    setCost((c) => ({ ...Object.fromEntries(items.map((i) => [i.product_id, productOf(i.product_id)?.cost_price ?? ''])), ...c }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.data, items]);

  // The other branch with the most of these products is suggested as the transfer source.
  const sources = useMemo(
    () => branches.filter((b) => b.id !== branchId).map((b) => ({ branch: b, units: items.reduce((s, i) => s + stockAt(i.product_id, b.id), 0) })).sort((a, b) => b.units - a.units),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branches, branchId, items, products.data],
  );
  useEffect(() => {
    if (method === 'transfer' && fromBranch === '' && sources[0]) setFromBranch(sources[0].branch.id);
  }, [method, sources, fromBranch]);

  const applyTarget = (t: Target) => {
    setTarget(t);
    setQty(Object.fromEntries(items.map((i) => [i.product_id, String(suggest(i, t))])));
  };

  const lines = items.filter((i) => Number(qty[i.product_id]) > 0);
  const units = lines.reduce((s, i) => s + Number(qty[i.product_id]), 0);
  const value = lines.reduce((s, i) => s + Number(qty[i.product_id]) * (Number(cost[i.product_id]) || 0), 0);
  const overSource = method === 'transfer' && lines.some((i) => Number(qty[i.product_id]) > stockAt(i.product_id, fromBranch));
  const ready = lines.length > 0 && (method !== 'order' || supplierId !== '') && (method !== 'transfer' || (fromBranch !== '' && !overSource));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (method === 'receive') {
        await api(path('/goods-receipts'), {
          method: 'POST',
          body: {
            branch_id: branchId,
            supplier_id: supplierId ? Number(supplierId) : null,
            supplier_invoice_number: invoice || null,
            notes: 'Restock from low-stock list',
            items: lines.map((i) => ({ product_id: i.product_id, quantity: qty[i.product_id], ...(cost[i.product_id] ? { unit_cost: cost[i.product_id] } : {}) })),
          },
        });
        toast.success(`${formatQty(String(units))} units added to ${branchName(branchId)}.`);
      } else if (method === 'order') {
        const po = await api<{ data: { id: number; reference: string } }>(path('/purchase-orders'), {
          method: 'POST',
          body: { branch_id: branchId, supplier_id: Number(supplierId), items: lines.map((i) => ({ product_id: i.product_id, quantity: qty[i.product_id], unit_cost: cost[i.product_id] || '0' })) },
        });
        if (finishNow) await api(path(`/purchase-orders/${po.data.id}/order`), { method: 'POST' });
        toast.success(`Purchase order ${po.data.reference} ${finishNow ? 'sent' : 'saved as draft'}. Receive it in Purchasing when it arrives.`);
      } else {
        const tr = await api<{ data: { id: number; reference: string } }>(path('/stock-transfers'), {
          method: 'POST',
          body: { from_branch_id: fromBranch, to_branch_id: branchId, notes: 'Restock from low-stock list', items: lines.map((i) => ({ product_id: i.product_id, quantity: qty[i.product_id] })) },
        });
        if (finishNow) await api(path(`/stock-transfers/${tr.data.id}/dispatch`), { method: 'POST' });
        toast.success(`Transfer ${tr.data.reference} ${finishNow ? 'dispatched' : 'saved as draft'}. ${branchName(branchId)} receives it on arrival.`);
      }
      void queryClient.invalidateQueries({ queryKey: ['t', tenantId] });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const fieldErrors = error instanceof ApiError ? Object.values(error.errors).flat() : [];
  const cta = method === 'receive' ? `Add ${formatQty(String(units))} units to stock` : method === 'order' ? (finishNow ? 'Send purchase order' : 'Save draft order') : finishNow ? 'Send transfer' : 'Save draft transfer';

  return (
    <Modal open={open} onClose={onClose} title="Restock" icon={PackagePlus} size="xl"
      description={`${items.length} ${items.length === 1 ? 'product' : 'products'} for ${branchName(branchId)}`}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-slate-500">
            <strong className="text-slate-800">{lines.length}</strong> products · <strong className="text-slate-800">{formatQty(String(units))}</strong> units
            {method !== 'transfer' && value > 0 && <> · approx. <strong className="text-slate-800">{formatMoney(value.toFixed(2))}</strong></>}
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!ready} onClick={() => void submit()} icon={<Check className="size-4" />}>{cta}</Button>
        </>
      }>
      <div className="space-y-6">
        {error !== null && fieldErrors.length === 0 && <ErrorBanner error={error} />}
        {fieldErrors.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}

        {/* Which branch */}
        {branches.length > 1 && (
          <section>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="grid size-6 place-items-center rounded-full bg-brand-600 text-white"><Store className="size-3.5" /></span>Which branch are you restocking?</p>
            <div role="radiogroup" aria-label="Branch to restock" className="flex flex-wrap gap-2">
              {branches.map((b) => {
                const on = b.id === branchId;
                const low = products.data ? pickedItems.filter((i) => stockAt(i.product_id, b.id) <= Number(i.reorder_level)).length : null;
                return (
                  <button key={b.id} type="button" role="radio" aria-checked={on} onClick={() => setBranchId(b.id)}
                    className={cx('inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold ring-1 transition', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50')}>
                    <Store className="size-4" /> {b.name}
                    {low !== null && <span className={cx('rounded-full px-1.5 text-[11px]', on ? 'bg-white/20' : low ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>{low ? `${low} low` : 'stocked'}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* 1. How */}
        <section>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>Where is the stock coming from?</p>
          <div role="radiogroup" aria-label="Restock method" className="grid gap-3 sm:grid-cols-3">
            {methods.map((m) => {
              const on = method === m.value;
              return (
                <button key={m.value} type="button" role="radio" aria-checked={on} onClick={() => setMethod(m.value)}
                  className={cx('flex items-start gap-3 rounded-2xl p-4 text-left ring-1 transition', on ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-white ring-slate-200 hover:bg-slate-50')}>
                  <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}><m.icon className="size-5" /></span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{m.title}</span>
                    <span className="block text-xs text-slate-500">{m.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {methods.length === 0 && <p className="text-sm text-slate-500">You don't have permission to receive, order or transfer stock.</p>}
        </section>

        {/* Method details */}
        {method === 'receive' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier (optional)">{(id) => <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">No supplier / walk-in purchase</option>{suppliers.data?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            <Field label="Supplier invoice / DR no. (optional)">{(id) => <Input id={id} value={invoice} onChange={(e) => setInvoice(e.target.value)} />}</Field>
          </div>
        )}
        {method === 'order' && (
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <Field label="Supplier">{(id) => <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Choose supplier…</option>{suppliers.data?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            <Switch label="Mark as ordered now" description="Off saves it as a draft to review later." checked={finishNow} onChange={setFinishNow} />
          </div>
        )}
        {method === 'transfer' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-700">From</span>
              {sources.map(({ branch, units: u }) => (
                <button key={branch.id} type="button" onClick={() => setFromBranch(branch.id)}
                  className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition', fromBranch === branch.id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                  <Store className="size-3.5" />{branch.name}<span className={cx('rounded-full px-1.5 text-[10px]', fromBranch === branch.id ? 'bg-white/20' : 'bg-slate-100')}>{formatQty(String(u))} in stock</span>
                </button>
              ))}
              <ArrowRight className="size-4 text-slate-400" />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-brand-200"><Store className="size-3.5" />{branchName(branchId)}</span>
            </div>
            <Switch label="Dispatch now" description="Stock leaves the source branch immediately. Off saves a draft." checked={finishNow} onChange={setFinishNow} />
          </div>
        )}

        {/* 2. Quantities */}
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>How much?</p>
            <div className="ml-auto inline-flex rounded-xl bg-slate-100 p-1 text-xs font-medium">
              {([['reorder', 'Just above reorder level'], ['double', 'Fill up (2× reorder level)']] as [Target, string][]).map(([t, l]) => (
                <button key={t} type="button" onClick={() => applyTarget(t)} className={cx('rounded-lg px-3 py-1.5 transition', target === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{l}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2 text-left font-semibold">Product</th>
                  <th className="px-3 py-2 text-right font-semibold">On hand</th>
                  <th className="px-3 py-2 text-right font-semibold">Reorder at</th>
                  {method === 'transfer' && <th className="px-3 py-2 text-right font-semibold">At source</th>}
                  <th className="px-3 py-2 text-right font-semibold">Add</th>
                  {method !== 'transfer' && <th className="px-3 py-2 text-right font-semibold">Unit cost</th>}
                  <th className="px-4 py-2 text-right font-semibold">New level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => {
                  const add = Number(qty[i.product_id]) || 0;
                  const after = Number(i.quantity) + add;
                  const available = stockAt(i.product_id, fromBranch);
                  const short = method === 'transfer' && add > available;
                  return (
                    <tr key={i.product_id} className={cx(add === 0 && 'opacity-50')}>
                      <td className="px-4 py-2.5"><span className="block font-medium text-slate-900">{i.name}</span><span className="font-mono text-[11px] text-slate-400">{i.sku}</span></td>
                      <td className={cx('px-3 py-2.5 text-right tabular-nums', Number(i.quantity) <= 0 ? 'font-semibold text-rose-600' : 'text-amber-700')}>{formatQty(i.quantity)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatQty(i.reorder_level)}</td>
                      {method === 'transfer' && <td className={cx('px-3 py-2.5 text-right tabular-nums', short ? 'font-semibold text-rose-600' : 'text-slate-500')}>{formatQty(String(available))}</td>}
                      <td className="px-3 py-2.5 text-right">
                        <span className={cx('ml-auto flex h-9 w-28 items-center rounded-lg bg-white ring-1 focus-within:ring-2 focus-within:ring-brand-500', short ? 'ring-rose-400' : 'ring-slate-200')}>
                          <input inputMode="decimal" aria-label={`Quantity to add for ${i.name}`} value={qty[i.product_id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [i.product_id]: e.target.value.replace(/[^\d.]/g, '') }))}
                            className="h-full w-full bg-transparent px-2 text-right font-semibold tabular-nums outline-none" />
                          <span className="pr-2 text-[11px] text-slate-400">{i.unit}</span>
                        </span>
                      </td>
                      {method !== 'transfer' && (
                        <td className="px-3 py-2.5 text-right">
                          <span className="ml-auto flex h-9 w-28 items-center rounded-lg bg-white ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand-500">
                            <span className="pl-2 text-xs text-slate-400">₱</span>
                            <input inputMode="decimal" aria-label={`Unit cost for ${i.name}`} placeholder="avg" value={cost[i.product_id] ?? ''} onChange={(e) => setCost((c) => ({ ...c, [i.product_id]: e.target.value.replace(/[^\d.]/g, '') }))}
                              className="h-full w-full bg-transparent px-2 text-right tabular-nums outline-none" />
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right">
                        <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', after > Number(i.reorder_level) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                          {after > Number(i.reorder_level) && <Check className="size-3" />}{formatQty(String(after))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {overSource && <p className="mt-2 text-xs text-rose-600">Some quantities are more than the source branch has. Lower them or pick another branch.</p>}
          <p className="mt-2 text-xs text-slate-500">Set a quantity to 0 to skip a product.</p>
        </section>
      </div>
    </Modal>
  );
}
