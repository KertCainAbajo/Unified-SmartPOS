import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, LogOut, Minus, Monitor, PackageSearch, Percent, Plus, Printer, ScanBarcode, Search, ShoppingCart, Store, Trash2, UserRound, Wallet, X } from 'lucide-react';
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ReceiptView } from '../../components/ReceiptView';
import { useToast } from '../../components/Toast';
import { Avatar, Button, ErrorBanner, Input, Modal, SearchField, Spinner, cx } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { cartPayload, cartReducer, emptyCart, isValidQuantity, type CartLine, type LineDiscount, type SaleDiscountType } from '../../lib/cart';
import { formatMoney, formatQty, newIdempotencyKey } from '../../lib/format';
import { printDocument } from '../../lib/print';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { Branch, Category, Customer, Paginated, Product, QuoteLine, QuoteTotals, Receipt, Register, RegisterSession, Sale } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';
import { CloseShiftModal, OpenShiftCard, ZReadingModal } from './ShiftDialogs';
import { PaymentModal, type PaymentLine } from './PaymentModal';

/** Owners and managers can sell on a register another cashier already opened; remembered per tab until they leave it. */
const borrowKey = (tenantId: number | string) => `pos-borrowed-shift-${tenantId}`;
function readBorrowed(tenantId: number | string): number | null {
  try { const v = Number(sessionStorage.getItem(borrowKey(tenantId))); return v > 0 ? v : null; } catch { return null; }
}
function writeBorrowed(tenantId: number | string, id: number | null) {
  try { if (id) sessionStorage.setItem(borrowKey(tenantId), String(id)); else sessionStorage.removeItem(borrowKey(tenantId)); } catch { /* storage unavailable */ }
}

export function PosPage() {
  const { can, branch, branches, tenantId } = useTenant();
  const [searchParams] = useSearchParams();
  const onlineOrderId = searchParams.get('online_order_id');
  const current = useTenantQuery<{ data: RegisterSession | null }>('/register-sessions/current');
  const registers = useTenantQuery<{ data: Register[] }>('/registers', { branch_id: branch?.id }, { enabled: !!branch });
  const [zReading, setZReading] = useState<RegisterSession | null>(null);
  const [borrowedId, setBorrowedIdState] = useState<number | null>(() => readBorrowed(tenantId));
  const setBorrowedId = (id: number | null) => { writeBorrowed(tenantId, id); setBorrowedIdState(id); };
  const ownSession = current.data?.data;
  const borrowed = useTenantQuery<{ data: RegisterSession }>(`/register-sessions/${borrowedId}`, undefined, { enabled: !!borrowedId && !ownSession && can('shifts.view_all') });
  const borrowedSession = borrowed.data?.data;
  const borrowedUsable = !!borrowedSession && borrowedSession.status === 'open' && borrowedSession.branch_id === branch?.id;

  // Forget a borrowed register once its shift is closed, it belongs to another branch, or it can no longer be read.
  useEffect(() => {
    if (borrowedId && (borrowed.isError || (borrowedSession && !borrowedUsable))) { writeBorrowed(tenantId, null); setBorrowedIdState(null); }
  }, [borrowedId, borrowed.isError, borrowedSession, borrowedUsable, tenantId]);

  if (!can('sales.create')) return <NoAccess what="the point of sale" />;
  if (current.isPending) return <Spinner />;
  if (current.error) return <ErrorBanner error={current.error} />;

  const session = ownSession ?? (borrowedUsable ? borrowedSession : undefined);
  const zModal = zReading && <ZReadingModal session={zReading} onClose={() => setZReading(null)} />;
  if (!session) {
    if (registers.isPending || (borrowedId && borrowed.isPending && can('shifts.view_all'))) return <Spinner />;
    return (
      <>
        <OpenShiftCard key={branch?.id} registers={registers.data?.data ?? []} branchName={branch?.name ?? ''} forOnlineOrder={!!onlineOrderId}
          onUseOpen={can('shifts.view_all') ? (r) => r.open_session && setBorrowedId(r.open_session.id) : undefined} />
        {zModal}
      </>
    );
  }

  const sessionBranch = branches.find((b) => b.id === session.branch_id);
  const register = registers.data?.data.find((r) => r.id === session.register_id);
  const borrowedFrom = ownSession ? null : (register?.open_session?.opened_by_name ?? 'another cashier');
  return (
    <>
      <Terminal key={session.id} session={session} branchName={sessionBranch?.name ?? `Branch ${session.branch_id}`} onShiftClosed={(s) => { setBorrowedId(null); setZReading(s); }} onlineOrderId={onlineOrderId}
        borrowedFrom={borrowedFrom} onLeave={() => setBorrowedId(null)} />
      {zModal}
    </>
  );
}

function Terminal({ session, branchName, onShiftClosed, onlineOrderId, borrowedFrom, onLeave }: { session: RegisterSession; branchName: string; onShiftClosed: (s: RegisterSession) => void; onlineOrderId: string | null; borrowedFrom: string | null; onLeave: () => void }) {
  const { can, path, tenantId } = useTenant();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [paying, setPaying] = useState(false);
  const [completed, setCompleted] = useState<{ sale: Sale; receipt: Receipt } | null>(null);
  const [closingShift, setClosingShift] = useState(false);
  const [switchTo, setSwitchTo] = useState<Branch | null>(null);
  const [switching, setSwitching] = useState<Branch | null>(null);
  const { setBranchId } = useTenant();
  const [discountLine, setDiscountLine] = useState<CartLine | null>(null);
  const [customerPicker, setCustomerPicker] = useState(false);
  const lastAttempt = useRef<{ body: string; key: string } | null>(null);
  const loadedOrderId = useRef<string | null>(null);
  const onlineOrder = useQuery({
    queryKey: ['t', tenantId, 'online-order-checkout', onlineOrderId],
    queryFn: () => api<{ data: { id: number; status: string; fulfilment: string; cash_amount: string | null; branch_id: number; order_number: string; items: { product_id: number; sku: string; name: string; unit: string; unit_price: string; quantity: string }[] } }>(path(`/online-orders/${onlineOrderId}`)),
    enabled: !!onlineOrderId,
    retry: false,
  });

  useEffect(() => {
    const order = onlineOrder.data?.data;
    if (!order || !onlineOrderId || loadedOrderId.current === onlineOrderId) return;
    loadedOrderId.current = onlineOrderId;
    if (order.branch_id !== session.branch_id) {
      toast.error(`Order ${order.order_number} belongs to another branch. Open a shift at that branch to check it out.`);
      return;
    }
    if (!['ready', 'out_for_delivery'].includes(order.status)) {
      toast.error('This order is not ready for checkout.');
      return;
    }
    dispatch({ type: 'clear' });
    for (const item of order.items) {
      dispatch({ type: 'add', quantity: item.quantity, product: {
        id: item.product_id, sku: item.sku, name: item.name, unit: item.unit, price: item.unit_price,
        allow_decimal_quantity: true, track_inventory: true,
      } });
    }
  }, [onlineOrder.data, onlineOrderId, session.branch_id, toast]);

  // --- Server quote (authoritative totals), refreshed as the cart changes.
  const quantitiesValid = cart.lines.every(isValidQuantity);
  const scPwdComplete = cart.saleDiscount.type === 'none' || (cart.saleDiscount.idNumber.trim() !== '' && cart.saleDiscount.holderName.trim() !== '');
  const payload = cartPayload(cart, session.register_id);
  const debouncedPayload = useDebounced(JSON.stringify(payload), 250);
  const quote = useQuery({
    queryKey: ['t', tenantId, 'quote', debouncedPayload],
    queryFn: () => api<{ data: { totals: QuoteTotals; lines: QuoteLine[] } }>(path('/sales/quote'), { method: 'POST', body: JSON.parse(debouncedPayload) }),
    enabled: cart.lines.length > 0 && quantitiesValid && scPwdComplete,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const quoteFresh = debouncedPayload === JSON.stringify(payload) && !quote.isFetching;
  const totals = cart.lines.length > 0 ? quote.data?.data.totals : undefined;
  const quoteLines = new Map((quote.data?.data.lines ?? []).map((l, i) => [i, l]));
  const outOfStock = (quote.data?.data.lines ?? []).some((l) => !l.in_stock);

  // --- Checkout with an idempotency key reused only for an identical retry.
  const checkout = useMutation({
    mutationFn: (payments: PaymentLine[]) => {
      const body = { ...payload, ...(onlineOrderId ? { online_order_id: Number(onlineOrderId) } : {}), payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference_number: p.reference_number || null })) };
      const serialized = JSON.stringify(body);
      if (lastAttempt.current?.body !== serialized) lastAttempt.current = { body: serialized, key: newIdempotencyKey() };
      return api<{ data: Sale; receipt: Receipt }>(path('/sales'), {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': lastAttempt.current.key },
      });
    },
    onSuccess: (result) => {
      lastAttempt.current = null;
      setPaying(false);
      setCompleted({ sale: result.data, receipt: result.receipt });
      dispatch({ type: 'clear' });
      if (onlineOrderId) navigate(`/t/${tenantId}/pos`, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ['t', tenantId] });
    },
  });

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7.5rem)] lg:flex-row">
      <h1 className="sr-only">Point of Sale · {branchName}</h1>
      {/* Products */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden rounded-2xl bg-gradient-to-r from-brand-700 via-brand-800 to-brand-900 px-4 py-3 text-white shadow-md shadow-brand-900/20">
          <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-40 rounded-full bg-sun-400/20 blur-2xl" />
          <span className="relative inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-300/30">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" /> {borrowedFrom ? `${borrowedFrom}'s shift` : 'Shift open'}
          </span>
          <BranchPicker currentId={session.branch_id} currentName={branchName} onPick={(b) => (borrowedFrom ? (onLeave(), setBranchId(b.id)) : setSwitchTo(b))} />
          <span className="relative flex items-center gap-1.5 text-sm text-brand-100"><Monitor className="size-4" />Register #{session.register_id}</span>
          <span className="relative flex items-center gap-1.5 text-sm text-brand-100"><Clock className="size-4" /><ShiftTimer since={session.opened_at} /></span>
          {borrowedFrom ? (
            <button type="button" onClick={onLeave} title="Stop using this register. The shift stays open for its cashier." className="relative ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold ring-1 ring-white/20 transition hover:bg-white/20">
              <LogOut className="size-3.5" /> Leave register
            </button>
          ) : (
            <button type="button" onClick={() => setClosingShift(true)} className="relative ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold ring-1 ring-white/20 transition hover:bg-white/20">
              <LogOut className="size-3.5" /> Close shift
            </button>
          )}
        </div>
        {onlineOrderId ? <div className="space-y-2">{onlineOrder.isError && <ErrorBanner error={onlineOrder.error} />}{onlineOrder.isPending ? <Spinner label="Loading online order…" /> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200"><span>Checking out online order {onlineOrder.data?.data.order_number ?? `#${onlineOrderId}`}. Confirm its payment below.</span><Button type="button" variant="secondary" size="sm" icon={<X className="size-4" />} onClick={() => navigate(`/t/${tenantId}/online-orders`)}>Cancel checkout</Button></div>}</div> : <ProductPicker branchId={session.branch_id} onPick={(product) => dispatch({ type: 'add', product })} />}
      </div>

      {/* Cart */}
      <section className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-white shadow-lg shadow-slate-900/5 ring-1 ring-slate-900/5 lg:w-[440px]">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600"><ShoppingCart className="size-4" /></span>
          <div className="flex-1">
            <h2 className="font-display text-sm font-semibold text-slate-900">Current sale</h2>
            <p className="text-xs text-slate-400">{cart.lines.length === 0 ? 'Empty' : `${cart.lines.length} ${cart.lines.length === 1 ? 'item' : 'items'}`}{cart.customer && <> · {cart.customer.name}</>}</p>
          </div>
          {cart.lines.length > 0 && !onlineOrderId && (
            <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600" onClick={() => dispatch({ type: 'clear' })}>
              <Trash2 className="size-3.5" /> Clear
            </button>
          )}
        </div>

        <ul className="min-h-40 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {cart.lines.length === 0 && (
            <li className="flex flex-col items-center px-6 py-14 text-center">
              <span className="relative grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                <ScanBarcode className="size-7" />
                <span aria-hidden className="absolute -right-1 -top-1 size-3.5 rounded-full bg-sun-400 ring-2 ring-white" />
              </span>
              <p className="mt-4 font-display font-semibold text-slate-900">Ready for the next customer</p>
              <p className="mt-1 text-sm text-slate-500">Scan a barcode or tap a product to start.</p>
            </li>
          )}
          {cart.lines.map((line, i) => {
            const q = quoteFresh ? quoteLines.get(i) : undefined;
            const validQty = isValidQuantity(line);
            return (
              <li key={line.key} className="auth-fade px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-[11px] font-bold text-white">{line.product.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{line.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatMoney(line.product.price)} / {line.product.unit}
                      {line.discount && (
                        <span className="ml-1 rounded bg-brand-50 px-1 font-medium text-brand-700">
                          · {line.discount.type === 'percent' ? `${line.discount.value}% off` : `${formatMoney(line.discount.value)} off`}
                        </span>
                      )}
                    </p>
                    {q && !q.in_stock && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="size-3" /> Only {formatQty(q.available_stock)} in stock
                      </p>
                    )}
                  </div>
                  <p className="font-display text-sm font-semibold tabular-nums text-slate-900">{q ? formatMoney(q.line_total) : <span className="inline-block h-4 w-14 animate-pulse rounded bg-slate-100" />}</p>
                </div>
                <div className="mt-2 flex items-center gap-1 pl-12">
                  <div className={cx('inline-flex items-center rounded-lg bg-slate-50 ring-1', validQty ? 'ring-slate-200' : 'ring-red-400')}>
                  <button type="button" disabled={!!onlineOrderId} className="grid size-8 place-items-center rounded-l-lg text-slate-500 transition hover:bg-white hover:text-brand-700 disabled:opacity-40" aria-label="Decrease" onClick={() => dispatch({ type: 'increment', key: line.key, by: -1 })}>
                    <Minus className="size-3.5" />
                  </button>
                  <input
                    className="h-8 w-14 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                    inputMode={line.product.allow_decimal_quantity ? 'decimal' : 'numeric'}
                    value={line.quantity}
                    disabled={!!onlineOrderId}
                    aria-label={`Quantity of ${line.product.name}`}
                    onChange={(e) => dispatch({ type: 'setQuantity', key: line.key, quantity: e.target.value })}
                  />
                  <button type="button" disabled={!!onlineOrderId} className="grid size-8 place-items-center rounded-r-lg text-slate-500 transition hover:bg-white hover:text-brand-700 disabled:opacity-40" aria-label="Increase" onClick={() => dispatch({ type: 'increment', key: line.key, by: 1 })}>
                    <Plus className="size-3.5" />
                  </button>
                  </div>
                  {!onlineOrderId && can('sales.discount') && cart.saleDiscount.type === 'none' && (
                    <Button variant="ghost" size="sm" aria-label="Line discount" onClick={() => setDiscountLine(line)}>
                      <Percent className="size-3.5" />
                    </Button>
                  )}
                  {!onlineOrderId && <Button variant="ghost" size="sm" className="ml-auto text-slate-400 hover:text-red-600" aria-label="Remove" onClick={() => dispatch({ type: 'remove', key: line.key })}>
                    <Trash2 className="size-4" />
                  </Button>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="space-y-3 border-t border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {!onlineOrderId && <div role="radiogroup" aria-label="Statutory discount" className="inline-flex h-9 flex-1 items-center gap-0.5 rounded-xl bg-slate-100 p-1 text-xs font-medium">
              {([['none', 'Regular'], ['senior_citizen', 'Senior'], ['pwd', 'PWD']] as [SaleDiscountType, string][]).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={cart.saleDiscount.type === v} title={v === 'none' ? 'No SC/PWD discount' : '20% off + VAT exempt'}
                  onClick={() => dispatch({ type: 'setSaleDiscount', discount: { ...cart.saleDiscount, type: v } })}
                  className={cx('h-full flex-1 rounded-lg transition', cart.saleDiscount.type === v ? (v === 'none' ? 'bg-white text-brand-800 shadow-sm' : 'bg-violet-600 text-white shadow-sm') : 'text-slate-500 hover:text-slate-800')}>
                  {l}
                </button>
              ))}
            </div>}
            {!onlineOrderId && can('customers.view') && (
              <button type="button" onClick={() => setCustomerPicker(true)}
                className={cx('inline-flex h-9 max-w-40 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold ring-1 transition', cart.customer ? 'bg-brand-50 text-brand-800 ring-brand-200' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                <UserRound className="size-4 shrink-0" /><span className="truncate">{cart.customer ? cart.customer.name : 'Customer'}</span>
              </button>
            )}
          </div>
          {cart.saleDiscount.type !== 'none' && (
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-violet-50/60 p-2 ring-1 ring-violet-100">
              <Input
                className="h-9"
                placeholder="ID number"
                value={cart.saleDiscount.idNumber}
                onChange={(e) => dispatch({ type: 'setSaleDiscount', discount: { ...cart.saleDiscount, idNumber: e.target.value } })}
              />
              <Input
                className="h-9"
                placeholder="Holder name"
                value={cart.saleDiscount.holderName}
                onChange={(e) => dispatch({ type: 'setSaleDiscount', discount: { ...cart.saleDiscount, holderName: e.target.value } })}
              />
            </div>
          )}

          {quote.error && cart.lines.length > 0 && <ErrorBanner error={quote.error} />}

          <dl className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-100">
            <Row label="Subtotal" value={totals?.subtotal} />
            {totals && Number(totals.vat_exemption_amount) > 0 && <Row label="Less VAT (SC/PWD)" value={`-${totals.vat_exemption_amount}`} />}
            {totals && Number(totals.discount_total) > 0 && <Row label="Discount" value={`-${totals.discount_total}`} />}
            <Row label="VAT (12%) included" value={totals?.vat_amount} muted />
            <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-slate-200 pt-2">
              <dt className="font-semibold text-slate-900">Total</dt>
              <dd className="font-display text-3xl font-bold tabular-nums text-brand-900">{totals ? formatMoney(totals.total) : formatMoney('0.00')}</dd>
            </div>
          </dl>

          <button
            type="button"
            className="group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sun-300 to-sun-400 font-display text-lg font-bold text-brand-900 shadow-lg shadow-sun-500/30 transition hover:from-sun-300 hover:to-sun-300 disabled:cursor-not-allowed disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none"
            disabled={!totals || !quoteFresh || !quantitiesValid || !scPwdComplete || !!quote.error}
            onClick={() => {
              checkout.reset();
              setPaying(true);
            }}
          >
            <Wallet className="size-5" /> Charge {totals ? formatMoney(totals.total) : ''}
            <ArrowRight className="size-5 transition group-hover:translate-x-1 group-disabled:hidden" />
          </button>
          {outOfStock && <p className="text-center text-xs text-amber-700">Some items exceed available stock; checkout will be refused unless stock allows it.</p>}
        </div>
      </section>

      <PaymentModal
        open={paying}
        total={totals?.total ?? '0.00'}
        busy={checkout.isPending}
        error={checkout.error}
        onClose={() => setPaying(false)}
        onSubmit={(payments) => checkout.mutate(payments)}
        defaultCashAmount={onlineOrder.data?.data.fulfilment === 'delivery' ? onlineOrder.data.data.cash_amount : null}
      />

      <Modal
        open={!!completed}
        onClose={() => setCompleted(null)}
        title="Sale complete"
        icon={CheckCircle2}
        description={completed ? <>Receipt {completed.sale.receipt_number}</> : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printDocument()}>
              Print receipt
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setCompleted(null)}>New sale</Button>
          </>
        }
      >
        {completed && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-center text-white shadow-md">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-100">Change due</p>
              <p className="font-display text-4xl font-bold tabular-nums text-sun-300">{formatMoney(completed.sale.change_due)}</p>
              <p className="mt-1 text-xs text-brand-100/80">Total {formatMoney(completed.sale.total)}</p>
            </div>
            <ReceiptView receipt={completed.receipt} />
          </div>
        )}
      </Modal>

      <LineDiscountModal
        line={discountLine}
        onClose={() => setDiscountLine(null)}
        onApply={(discount) => {
          if (discountLine) dispatch({ type: 'setLineDiscount', key: discountLine.key, discount });
          setDiscountLine(null);
        }}
      />

      <CustomerPicker
        open={customerPicker}
        onClose={() => setCustomerPicker(false)}
        onPick={(customer) => {
          dispatch({ type: 'setCustomer', customer });
          setCustomerPicker(false);
          if (customer) toast.success(`Customer: ${customer.name}`);
        }}
      />

      <CloseShiftModal
        session={session}
        open={closingShift}
        onClose={() => { setClosingShift(false); setSwitching(null); }}
        onClosed={(closed) => {
          setClosingShift(false);
          if (switching) setBranchId(switching.id);
          onShiftClosed(closed);
        }}
      />

      <Modal
        open={!!switchTo}
        onClose={() => setSwitchTo(null)}
        title={`Switch to ${switchTo?.name ?? ''}?`}
        icon={Store}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSwitchTo(null)}>Stay here</Button>
            <Button onClick={() => { setSwitching(switchTo); setSwitchTo(null); setClosingShift(true); }}>Close shift &amp; switch</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>Sales are recorded on the register where your shift is open. Your shift at <strong className="text-slate-900">{branchName}</strong> (Register #{session.register_id}) is still open.</p>
          <ol className="space-y-2">
            <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">1</span>Count the drawer and close this shift.</li>
            <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">2</span><span>Open a new shift at <strong className="text-slate-900">{switchTo?.name}</strong> and keep selling.</span></li>
          </ol>
          {cart.lines.length > 0 && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 ring-1 ring-amber-100">The {cart.lines.length} item(s) in the current sale will be cleared.</p>}
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value?: string; muted?: boolean }) {
  return (
    <div className={cx('flex justify-between', muted ? 'text-slate-400' : 'text-slate-600')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value !== undefined ? formatMoney(value) : '—'}</dd>
    </div>
  );
}

/** Search box that also accepts barcode scanners (which type the code and press Enter). */
function ProductPicker({ branchId, onPick }: { branchId: number; onPick: (p: Product) => void }) {
  const { path } = useTenant();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 250);
  const inputRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const categories = useTenantQuery<{ data: Category[] }>('/categories');
  const results = useTenantQuery<Paginated<Product>>('/products', { q: debounced || undefined, category_id: categoryId ?? undefined, with_stock: 1, per_page: 30 });

  useEffect(() => inputRef.current?.focus(), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const code = term.trim();
    if (!code) return;
    try {
      // Exact barcode, then exact SKU, then the single search hit.
      for (const query of [{ barcode: code }, { sku: code }]) {
        const found = await api<Paginated<Product>>(path('/products'), { query: { ...query, per_page: 1 } });
        if (found.data[0]) {
          onPick(found.data[0]);
          setTerm('');
          return;
        }
      }
      const hits = results.data?.data ?? [];
      if (debounced === term && hits.length === 1) {
        onPick(hits[0]);
        setTerm('');
      } else if (hits.length === 0) {
        toast.error(`No product matches "${code}".`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-brand-600" />
          <Input
            ref={inputRef}
            className="h-12 rounded-2xl bg-slate-50 pl-12 text-base focus:bg-white"
            placeholder="Scan barcode or search name / SKU"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label="Scan or search products"
          />
          {term && (
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setTerm('')} aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button type="submit" size="lg" icon={<Search className="size-4" />}>
          Add
        </Button>
      </form>
      {(categories.data?.data.length ?? 0) > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 px-3 py-2 [scrollbar-width:none]">
          {[{ id: null as number | null, name: 'All products' }, ...(categories.data?.data ?? []).filter((c) => c.is_active)].map((c) => (
            <button key={c.id ?? 'all'} type="button" onClick={() => setCategoryId(c.id)}
              className={cx('shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition', categoryId === c.id ? 'bg-brand-700 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {results.isPending ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <span key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />)}</div>
        ) : results.error ? (
          <ErrorBanner error={results.error} />
        ) : results.data?.data.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><PackageSearch className="size-6" /></span>
            <p className="mt-3 font-medium text-slate-700">No products found</p>
            <p className="text-sm text-slate-500">Try another name, SKU or category.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {results.data?.data.map((p) => {
              const stock = p.stock?.find((s) => s.branch_id === branchId)?.quantity;
              const low = p.track_inventory && stock !== undefined && Number(stock) <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onPick(p);
                    inputRef.current?.focus();
                  }}
                  className={cx('group relative flex flex-col items-start rounded-xl border bg-white p-3 text-left transition active:scale-[0.98]', low ? 'border-rose-100 bg-rose-50/30' : 'border-slate-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md')}
                >
                  <span className="mb-2 flex w-full items-start justify-between gap-2">
                    <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[11px] font-bold text-white', TILES[p.id % TILES.length])}>{p.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}</span>
                    <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-brand-600 opacity-0 transition group-hover:opacity-100"><Plus className="size-4" /></span>
                  </span>
                  <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">{p.name}</span>
                  <span className="mt-0.5 font-mono text-[10px] text-slate-400">{p.sku}</span>
                  <span className="mt-auto flex w-full items-end justify-between pt-2">
                    <span className="font-display font-bold tabular-nums text-brand-900">{formatMoney(p.price)}</span>
                    {p.track_inventory && (
                      <span className={cx('rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums', low ? 'bg-rose-100 text-rose-700' : Number(stock ?? 0) <= Number(p.reorder_level) ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500')}>{stock !== undefined ? `${formatQty(stock)} ${p.unit}` : 'Out'}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const TILES = ['from-brand-400 to-brand-600', 'from-sky-400 to-sky-600', 'from-amber-400 to-orange-500', 'from-violet-400 to-violet-600', 'from-rose-400 to-rose-600', 'from-teal-400 to-emerald-600'];

/** Branch name on the POS bar; opens a list of the branches you can sell at. */
function BranchPicker({ currentId, currentName, onPick }: { currentId: number; currentName: string; onPick: (b: Branch) => void }) {
  const { branches } = useTenant();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (branches.length < 2) return <span className="relative flex items-center gap-1.5 text-sm"><Store className="size-4 text-sun-300" />{currentName}</span>;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium ring-1 ring-white/20 transition hover:bg-white/10">
        <Store className="size-4 text-sun-300" />{currentName}<ChevronDown className={cx('size-4 text-brand-100 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" aria-label="Branches" className="auth-fade absolute left-0 top-10 z-40 w-64 rounded-2xl bg-white p-1.5 text-slate-700 shadow-xl ring-1 ring-slate-900/10">
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Sell at</p>
          {branches.map((b) => {
            const here = b.id === currentId;
            return (
              <button key={b.id} type="button" role="option" aria-selected={here} disabled={here}
                onClick={() => { setOpen(false); onPick(b); }}
                className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition', here ? 'bg-brand-50 text-brand-900' : 'hover:bg-slate-50')}>
                <span className={cx('grid size-8 place-items-center rounded-lg', here ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}><Store className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  {here && <span className="block text-[11px] text-emerald-700">Shift open here</span>}
                </span>
                {here && <Check className="size-4 text-brand-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Live "2h 14m" since the shift opened. */
function ShiftTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  return <>{Math.floor(mins / 60)}h {String(mins % 60).padStart(2, '0')}m</>;
}

function LineDiscountModal({ line, onClose, onApply }: { line: CartLine | null; onClose: () => void; onApply: (d?: LineDiscount) => void }) {
  const [type, setType] = useState<LineDiscount['type']>('percent');
  const [value, setValue] = useState('');

  useEffect(() => {
    setType(line?.discount?.type ?? 'percent');
    setValue(line?.discount?.value ?? '');
  }, [line]);

  const valid = /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0 && (type === 'fixed' || Number(value) <= 100);

  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title="Line discount"
      icon={Percent}
      description={line?.product.name}
      size="sm"
      footer={
        <>
          {line?.discount && (
            <Button variant="ghost" onClick={() => onApply(undefined)}>
              Remove discount
            </Button>
          )}
          <Button disabled={!valid} onClick={() => onApply({ type, value })}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Discount type" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {([['percent', 'Percent (%)'], ['fixed', 'Amount (₱)']] as [LineDiscount['type'], string][]).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => setType(v)} className={cx('h-9 rounded-lg transition', type === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{l}</button>
          ))}
        </div>
        <div className="flex h-14 items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
          {type === 'fixed' && <span className="font-display text-2xl font-bold text-slate-400">₱</span>}
          <input inputMode="decimal" autoFocus aria-label="Discount value" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)} className="h-full w-full bg-transparent px-2 font-display text-2xl font-bold tabular-nums outline-none" />
          {type === 'percent' && <span className="font-display text-2xl font-bold text-slate-400">%</span>}
        </div>
        {type === 'percent' && (
          <div className="flex gap-2">
            {['5', '10', '15', '20', '50'].map((v) => <button key={v} type="button" onClick={() => setValue(v)} className={cx('flex-1 rounded-lg py-1.5 text-xs font-semibold ring-1 transition', value === v ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{v}%</button>)}
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">The server recalculates the discount and VAT; it cannot exceed the line amount.</p>
    </Modal>
  );
}

function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: { id: number; name: string } | null) => void }) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term);
  const list = useTenantQuery<Paginated<Customer>>('/customers', { q: debounced || undefined, per_page: 10 }, { enabled: open });

  return (
    <Modal open={open} onClose={onClose} title="Select customer" icon={UserRound} description="Attach the sale to a customer record." footer={<Button variant="ghost" onClick={() => onPick(null)}>Walk-in (no customer)</Button>}>
      <SearchField value={term} onChange={setTerm} placeholder="Search name, phone or email" />
      <ul className="mt-3 space-y-1">
        {list.error && <ErrorBanner error={list.error} />}
        {list.data?.data.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition hover:bg-brand-50" onClick={() => onPick({ id: c.id, name: c.name })}>
              <Avatar name={c.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{c.name}</span><span className="block truncate text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}</span></span>
              <ChevronRight className="size-4 text-slate-300" />
            </button>
          </li>
        ))}
        {list.data?.data.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No customers found. Add them on the Customers page.</li>}
      </ul>
    </Modal>
  );
}

