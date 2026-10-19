import { ArrowLeft, Ban, Bike, Calculator, Package, Printer, ReceiptText, RotateCcw, ShoppingBag, Store, Wallet } from 'lucide-react';
import { BranchTag } from '../../components/BranchSwitcher';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ReceiptView } from '../../components/ReceiptView';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatMoney, formatQty, titleCase } from '../../lib/format';
import { printDocument } from '../../lib/print';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { PaymentMethod, Receipt, Refund, Sale, SaleItem } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';

export function SaleDetailPage() {
  const { saleId } = useParams();
  const { can, tenantId } = useTenant();
  const sale = useTenantQuery<{ data: Sale }>(`/sales/${saleId}`);
  const receipt = useTenantQuery<{ data: Receipt }>(`/sales/${saleId}/receipt`);
  const refunds = useTenantQuery<{ data: Refund[] }>('/refunds', { sale_id: saleId }, { enabled: can('refunds.create') || can('refunds.approve') });
  const [showReceipt, setShowReceipt] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [refunding, setRefunding] = useState(false);

  if (sale.isPending) return <Spinner />;
  if (sale.error) return <ErrorBanner error={sale.error} />;
  const s = sale.data.data;
  const refundable = s.status === 'completed' && s.payment_status !== 'refunded';

  return (
    <>
      <Link to={`/t/${tenantId}/sales`} className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-900/5 transition hover:text-brand-800 hover:ring-brand-200">
        <ArrowLeft className="size-3.5" /> All sales
      </Link>
      <PageHeader
        eyebrow="Sale"
        title={`Receipt ${s.receipt_number}`}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span>{formatDateTime(s.sold_at)}</span><span>Cashier: <strong className="font-semibold text-slate-700">{s.cashier?.name ?? '—'}</strong></span>{s.customer && <span>Customer: <strong className="font-semibold text-slate-700">{s.customer.name}</strong></span>}<BranchTag id={s.branch_id} /><ChannelTag sale={s} /></span>}
        actions={
          <>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => setShowReceipt(true)} disabled={!receipt.data}>
              Receipt
            </Button>
            {can('refunds.create') && refundable && (
              <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setRefunding(true)}>
                Refund
              </Button>
            )}
            {can('sales.void') && s.status === 'completed' && Number(s.refunded_total) === 0 && (
              <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setVoiding(true)}>
                Void
              </Button>
            )}
          </>
        }
      />

      <section className={cx('mb-6 flex flex-wrap items-center gap-4 rounded-2xl p-5 shadow-sm ring-1', s.status === 'voided' ? 'bg-rose-50/60 ring-rose-100' : 'bg-gradient-to-r from-brand-700 to-brand-900 text-white ring-brand-900')}>
        <span className={cx('grid size-12 place-items-center rounded-2xl', s.status === 'voided' ? 'bg-rose-100 text-rose-600' : 'bg-white/15 text-sun-300')}>{s.status === 'voided' ? <Ban className="size-6" /> : <ReceiptText className="size-6" />}</span>
        <div className="flex-1">
          <p className={cx('text-[11px] font-semibold uppercase tracking-wider', s.status === 'voided' ? 'text-rose-600' : 'text-brand-100')}>{s.status === 'voided' ? 'Voided sale' : 'Sale total'}</p>
          <p className={cx('font-display text-3xl font-bold tabular-nums', s.status === 'voided' && 'text-slate-400 line-through')}>{formatMoney(s.total)}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {[['Items', String(s.items?.length ?? 0)], ['Paid', formatMoney(s.amount_tendered)], ['Change', formatMoney(s.change_due)]].map(([l, v]) => (
            <div key={l} className={cx('rounded-xl px-3 py-2', s.status === 'voided' ? 'bg-white ring-1 ring-rose-100' : 'bg-white/10 ring-1 ring-white/15')}>
              <p className={s.status === 'voided' ? 'text-slate-400' : 'text-brand-100/80'}>{l}</p>
              <p className="font-display font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <Badge status={s.status === 'voided' ? 'voided' : s.payment_status} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Items" subtitle={`${s.items?.length ?? 0} lines`} icon={Package} padded={false} className="lg:col-span-2">
          <DataTable
            rows={s.items}
            rowKey={(i) => i.id}
            columns={[
              { header: 'Product', cell: (i) => <><p className="font-medium text-slate-900">{i.name}</p><p className="text-xs text-slate-500">{i.sku}</p></> },
              { header: 'Qty', cell: (i) => `${formatQty(i.quantity)}${Number(i.quantity_refunded) > 0 ? ` (−${formatQty(i.quantity_refunded)} refunded)` : ''}`, align: 'right' },
              { header: 'Price', cell: (i) => formatMoney(i.unit_price), align: 'right' },
              { header: 'Discount', cell: (i) => (Number(i.discount_amount) > 0 ? formatMoney(i.discount_amount) : ''), align: 'right' },
              { header: 'Total', cell: (i) => formatMoney(i.line_total), align: 'right' },
            ]}
          />
        </Card>

        <div className="space-y-6">
          <Card title="Summary" icon={Calculator}>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd><Badge status={s.status === 'voided' ? 'voided' : s.payment_status} /></dd></div>
              <Line label="Subtotal" value={s.subtotal} />
              {Number(s.vat_exemption_amount) > 0 && <Line label="Less VAT (SC/PWD)" value={s.vat_exemption_amount} />}
              {Number(s.discount_total) > 0 && <Line label="Discounts" value={s.discount_total} />}
              <Line label="Total" value={s.total} strong />
              <Line label="VATable sales" value={s.vatable_sales} />
              <Line label="VAT" value={s.vat_amount} />
              <Line label="VAT-exempt sales" value={s.vat_exempt_sales} />
              <Line label="Tendered" value={s.amount_tendered} />
              <Line label="Change" value={s.change_due} />
              {Number(s.refunded_total) > 0 && <Line label="Refunded" value={s.refunded_total} strong />}
            </dl>
            {s.discount.type !== 'none' && (
              <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                {titleCase(s.discount.type)} · ID {s.discount.id_number} · {s.discount.holder_name}
              </p>
            )}
            {s.void_reason && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">Voided {formatDateTime(s.voided_at)}: {s.void_reason}</p>}
          </Card>

          <Card title="Payments" icon={Wallet} padded={false}>
            <DataTable
              rows={s.payments}
              rowKey={(p) => p.id}
              columns={[
                { header: 'Method', cell: (p) => `${titleCase(p.method)}${p.reference_number ? ` · ${p.reference_number}` : ''}` },
                { header: 'Amount', cell: (p) => formatMoney(p.amount), align: 'right' },
                { header: '', cell: (p) => (p.status !== 'completed' ? <Badge status={p.status} /> : null) },
              ]}
            />
          </Card>

          {refunds.data && refunds.data.data.length > 0 && (
            <Card title="Refunds" icon={RotateCcw} padded={false}>
              <DataTable
                rows={refunds.data.data}
                rowKey={(r) => r.id}
                columns={[
                  { header: 'Ref', cell: (r) => r.reference },
                  { header: 'Status', cell: (r) => <Badge status={r.status} /> },
                  { header: 'Total', cell: (r) => formatMoney(r.total), align: 'right' },
                ]}
              />
            </Card>
          )}
        </div>
      </div>

      <Modal open={showReceipt} onClose={() => setShowReceipt(false)} title="Receipt" icon={ReceiptText} size="sm" footer={<Button onClick={() => printDocument()} icon={<Printer className="size-4" />}>Print</Button>}>
        {receipt.data && <ReceiptView receipt={receipt.data.data} />}
      </Modal>

      <VoidModal sale={s} open={voiding} onClose={() => setVoiding(false)} />
      {s.items && <RefundModal sale={s} items={s.items} open={refunding} onClose={() => setRefunding(false)} />}
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold text-slate-900' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}

function VoidModal({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const voidSale = useTenantMutation<{ reason: string }>('POST', `/sales/${sale.id}/void`, { success: 'Sale voided. Stock and cash restored.', onSuccess: onClose, toastErrors: false });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Void ${sale.receipt_number}?`}
      icon={Ban}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} loading={voidSale.isPending} onClick={() => voidSale.mutate({ reason })}>Void sale</Button></>}
    >
      <p className="mb-4 text-sm text-slate-600">Voids are only allowed during the same open shift. The sale is kept on record as voided; stock and drawer cash are restored.</p>
      <ErrorBanner error={voidSale.error} className="mb-4" />
      <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
    </Modal>
  );
}

function RefundModal({ sale, items, open, onClose }: { sale: Sale; items: SaleItem[]; open: boolean; onClose: () => void }) {
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const current = useTenantQuery<{ data: { id: number; branch_id: number } | null }>('/register-sessions/current', undefined, { enabled: open });
  const refund = useTenantMutation<unknown, { data: Refund }>('POST', '/refunds', {
    success: (r) => (r.data.status === 'pending_approval' ? `Refund ${r.data.reference} sent for manager approval.` : `Refund ${r.data.reference} completed.`),
    onSuccess: () => {
      setQuantities({});
      setReason('');
      onClose();
    },
    toastErrors: false,
  });

  const lines = items
    .map((i) => ({ item: i, remaining: Number(i.quantity) - Number(i.quantity_refunded), qty: quantities[i.id] ?? '' }))
    .filter((l) => l.remaining > 0);
  const selected = lines.filter((l) => Number(l.qty) > 0);
  const shift = current.data?.data;
  const fieldErrors = refund.error instanceof ApiError ? Object.values(refund.error.errors).flat() : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Refund — ${sale.receipt_number}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={selected.length === 0 || !reason.trim()}
            loading={refund.isPending}
            onClick={() =>
              refund.mutate({
                sale_id: sale.id,
                reason,
                refund_method: method,
                register_session_id: method === 'cash' && shift && shift.branch_id === sale.branch_id ? shift.id : null,
                items: selected.map((l) => ({ sale_item_id: l.item.id, quantity: l.qty, restock })),
              })
            }
          >
            Submit refund
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Amounts are calculated by the server from the original sale. Large or late refunds need manager approval.</p>
        <ErrorBanner error={refund.error && fieldErrors.length === 0 ? refund.error : null} />
        {fieldErrors.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
        <table className="sp-cards w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Item</th><th className="py-1 text-right">Refundable</th><th className="py-1 text-right">Refund qty</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.item.id}>
                <td className="py-2">{l.item.name}</td>
                <td className="py-2 text-right tabular-nums">{formatQty(String(l.remaining))}</td>
                <td className="py-2 text-right">
                  <Input className="ml-auto h-8 w-24 text-right" inputMode="decimal" value={l.qty} placeholder="0" onChange={(e) => setQuantities((q) => ({ ...q, [l.item.id]: e.target.value }))} aria-label={`Refund quantity for ${l.item.name}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Field label="Refund method" hint={method === 'cash' ? (shift ? 'Cash is taken from your open shift.' : 'No open shift: cash is not tracked against a drawer.') : undefined}>
            {(id) => (
              <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {(['cash', 'gcash', 'maya', 'card', 'bank_transfer', 'other'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Checkbox label="Return items to stock" checked={restock} onChange={setRestock} />
      </div>
    </Modal>
  );
}

/** Counter sale, or the online pickup/delivery order this sale completed. */
function ChannelTag({ sale }: { sale: Sale }) {
  const order = sale.online_order;
  if (!order) return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600"><Store className="size-3.5" /> In store</span>;
  const delivery = order.fulfilment === 'delivery';
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', delivery ? 'bg-orange-50 text-orange-700' : 'bg-sky-50 text-sky-700')} title={order.delivery_address ?? undefined}>
      {delivery ? <Bike className="size-3.5" /> : <ShoppingBag className="size-3.5" />}
      {delivery ? 'Delivery' : 'Pickup'} · {order.order_number}{delivery && order.rider_name ? ` · rider ${order.rider_name}` : ''}
    </span>
  );
}
