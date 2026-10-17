import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { Button, ErrorBanner, Spinner } from '../../components/ui';

interface OnlineOrder {
  id: number;
  order_number: string;
  status: 'pending' | 'confirmed' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
  fulfilment: 'pickup' | 'delivery';
  delivery_address: string | null;
  cash_amount: string | null;
  change_due: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  contact_name: string;
  contact_phone: string;
  note: string | null;
  estimated_total: string;
  placed_at: string;
  branch: { id: number; name: string };
  account: { name: string; email: string; phone: string };
  items: { id: number; name: string; sku: string; unit: string; quantity: string; line_total: string }[];
}
interface StatusChange { id: number; status: string; cancel_reason?: string; rider_name?: string; rider_phone?: string }

const money = (v: string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(v));
const labels: Record<string, string> = { pending: 'New order', confirmed: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', completed: 'Completed', cancelled: 'Cancelled' };

export function OnlineOrdersPage() {
  const { scopeBranchId, can, tenantId } = useTenant();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useTenantQuery<Paginated<OnlineOrder>>('/online-orders', { branch_id: scopeBranchId, open: true, per_page: 50 });
  const status = useTenantMutation<StatusChange, { data: OnlineOrder }>('POST', (body) => `/online-orders/${body.id}/status`, {
    success: 'Order updated.', onSuccess: () => queryClient.invalidateQueries({ queryKey: ['t'] }),
  });

  if (list.isPending) return <Spinner label="Loading online orders…"/>;
  if (list.isError) return <ErrorBanner error={list.error}/>;
  const orders = list.data.data;

  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-brand-700">Pickup and delivery</p><h1 className="mt-1 font-display text-2xl font-bold">Online orders</h1><p className="mt-1 text-sm text-slate-500">Confirm and prepare orders, dispatch deliveries, then record payment through POS checkout.</p></div><Button variant="secondary" icon={<RefreshCw className="size-4"/>} onClick={() => list.refetch()}>Refresh</Button></div>
    {!orders.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><CheckCircle2 className="mx-auto size-8 text-brand-600"/><h2 className="mt-3 font-semibold">No open online orders</h2><p className="mt-1 text-sm text-slate-500">New pickup and delivery orders will show here.</p></div> : <div className="space-y-4">{orders.map((order) => <article key={order.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold">{order.order_number}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${order.status === 'ready' ? 'bg-emerald-100 text-emerald-800' : order.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{labels[order.status]}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">{order.fulfilment}</span></div><p className="mt-1 text-sm text-slate-500">{order.branch.name} · {new Date(order.placed_at).toLocaleString()}</p></div><p className="font-display text-lg font-bold">{money(order.estimated_total)}</p></div>
      <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-[1fr_1.5fr]"><div><p className="font-semibold">{order.contact_name}</p><p className="text-sm text-slate-600">{order.contact_phone}</p><p className="text-sm text-slate-500">{order.account.email}</p>{order.fulfilment === 'delivery' && <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-950"><p><b>Address:</b> {order.delivery_address}</p><p><b>Cash from customer:</b> {money(order.cash_amount ?? '0')}</p><p><b>Bring change:</b> {money(order.change_due ?? '0')}</p>{order.rider_name && <p><b>Rider:</b> {order.rider_name}{order.rider_phone ? ` · ${order.rider_phone}` : ''}</p>}</div>}{order.note && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Note: {order.note}</p>}</div><ul className="space-y-2">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-3 text-sm"><span>{item.quantity} {item.unit} × {item.name}</span><span className="font-medium">{money(item.line_total)}</span></li>)}</ul></div>
      {can('sales.create') && <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">{order.status === 'pending' && <Button loading={status.isPending} icon={<Check className="size-4"/>} onClick={() => status.mutate({ id: order.id, status: 'confirmed' })}>Confirm order</Button>}{order.status === 'confirmed' && <Button loading={status.isPending} icon={<CheckCircle2 className="size-4"/>} onClick={() => status.mutate({ id: order.id, status: 'ready' })}>Mark ready</Button>}{order.status === 'ready' && order.fulfilment === 'delivery' && <Button loading={status.isPending} icon={<CheckCircle2 className="size-4"/>} onClick={() => { const rider = window.prompt('Rider name:'); if (rider?.trim()) { const phone = window.prompt('Rider phone (optional):') ?? ''; status.mutate({ id: order.id, status: 'out_for_delivery', rider_name: rider.trim(), rider_phone: phone.trim() }); } }}>Dispatch to rider</Button>}{order.status === 'ready' && order.fulfilment === 'pickup' && <Button loading={status.isPending} icon={<CheckCircle2 className="size-4"/>} onClick={() => navigate(`/t/${tenantId}/pos?online_order_id=${order.id}`)}>Complete pickup</Button>}{order.status === 'out_for_delivery' && <Button loading={status.isPending} icon={<CheckCircle2 className="size-4"/>} onClick={() => navigate(`/t/${tenantId}/pos?online_order_id=${order.id}`)}>Complete delivery</Button>}{['pending', 'confirmed', 'ready', 'out_for_delivery'].includes(order.status) && <Button variant="danger" loading={status.isPending} icon={<XCircle className="size-4"/>} onClick={() => { const reason = window.prompt('Reason for cancelling this order:'); if (reason?.trim()) status.mutate({ id: order.id, status: 'cancelled', cancel_reason: reason.trim() }); }}>Cancel order</Button>}</div>}
    </article>)}</div>}
  </div>;
}
