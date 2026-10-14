import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Minus, Percent, Plus, ScanBarcode, Search, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { ReceiptView } from '../../components/ReceiptView';
import { useToast } from '../../components/Toast';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, Select, Spinner, cx } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { cartPayload, cartReducer, emptyCart, isValidQuantity, type CartLine, type LineDiscount, type SaleDiscountType } from '../../lib/cart';
import { formatMoney, formatQty, newIdempotencyKey } from '../../lib/format';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { Customer, Paginated, Product, QuoteLine, QuoteTotals, Receipt, Register, RegisterSession, Sale } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';
import { CloseShiftModal, OpenShiftCard } from './ShiftDialogs';
import { PaymentModal, type PaymentLine } from './PaymentModal';

export function PosPage() {
  const { can, branch, branches } = useTenant();
  const current = useTenantQuery<{ data: RegisterSession | null }>('/register-sessions/current');
  const registers = useTenantQuery<{ data: Register[] }>('/registers', { branch_id: branch?.id }, { enabled: !!branch });

  if (!can('sales.create')) return <NoAccess what="the point of sale" />;
  if (current.isPending) return <Spinner />;
  if (current.error) return <ErrorBanner error={current.error} />;

  const session = current.data?.data;
  if (!session) {
    if (registers.isPending) return <Spinner />;
    return <OpenShiftCard registers={registers.data?.data ?? []} branchName={branch?.name ?? ''} />;
  }

  const sessionBranch = branches.find((b) => b.id === session.branch_id);
  return <Terminal session={session} branchName={sessionBranch?.name ?? `Branch ${session.branch_id}`} />;
}

function Terminal({ session, branchName }: { session: RegisterSession; branchName: string }) {
  const { can, path, tenantId } = useTenant();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [paying, setPaying] = useState(false);
  const [completed, setCompleted] = useState<{ sale: Sale; receipt: Receipt } | null>(null);
  const [closingShift, setClosingShift] = useState(false);
  const [discountLine, setDiscountLine] = useState<CartLine | null>(null);
  const [customerPicker, setCustomerPicker] = useState(false);
  const lastAttempt = useRef<{ body: string; key: string } | null>(null);

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
      const body = { ...payload, payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference_number: p.reference_number || null })) };
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
      void queryClient.invalidateQueries({ queryKey: ['t', tenantId] });
    },
  });

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7.5rem)] lg:flex-row">
      {/* Products */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Badge status="open">Shift open</Badge>
          <span>
            {branchName} · Register #{session.register_id}
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setClosingShift(true)}>
            Close shift
          </Button>
        </div>
        <ProductPicker branchId={session.branch_id} onPick={(product) => dispatch({ type: 'add', product })} />
      </div>

      {/* Cart */}
      <Card className="flex min-h-0 w-full flex-col lg:w-[420px]" padded={false}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Current sale</h2>
          {cart.lines.length > 0 && (
            <button className="text-xs font-medium text-slate-500 hover:text-red-600" onClick={() => dispatch({ type: 'clear' })}>
              Clear
            </button>
          )}
        </div>

        <ul className="min-h-40 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {cart.lines.length === 0 && <li className="px-4 py-12 text-center text-sm text-slate-500">Scan a barcode or tap a product to start.</li>}
          {cart.lines.map((line, i) => {
            const q = quoteFresh ? quoteLines.get(i) : undefined;
            const validQty = isValidQuantity(line);
            return (
              <li key={line.key} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{line.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatMoney(line.product.price)} / {line.product.unit}
                      {line.discount && (
                        <span className="ml-1 text-teal-700">
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
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{q ? formatMoney(q.line_total) : '…'}</p>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <Button variant="secondary" size="sm" aria-label="Decrease" onClick={() => dispatch({ type: 'increment', key: line.key, by: -1 })}>
                    <Minus className="size-3.5" />
                  </Button>
                  <Input
                    className={cx('h-8 w-20 text-center tabular-nums', !validQty && 'border-red-500')}
                    inputMode={line.product.allow_decimal_quantity ? 'decimal' : 'numeric'}
                    value={line.quantity}
                    aria-label={`Quantity of ${line.product.name}`}
                    onChange={(e) => dispatch({ type: 'setQuantity', key: line.key, quantity: e.target.value })}
                  />
                  <Button variant="secondary" size="sm" aria-label="Increase" onClick={() => dispatch({ type: 'increment', key: line.key, by: 1 })}>
                    <Plus className="size-3.5" />
                  </Button>
                  {can('sales.discount') && cart.saleDiscount.type === 'none' && (
                    <Button variant="ghost" size="sm" aria-label="Line discount" onClick={() => setDiscountLine(line)}>
                      <Percent className="size-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="ml-auto text-slate-400 hover:text-red-600" aria-label="Remove" onClick={() => dispatch({ type: 'remove', key: line.key })}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="space-y-3 border-t border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <Select
              className="h-9 w-auto flex-1"
              aria-label="Statutory discount"
              value={cart.saleDiscount.type}
              onChange={(e) => dispatch({ type: 'setSaleDiscount', discount: { ...cart.saleDiscount, type: e.target.value as SaleDiscountType } })}
            >
              <option value="none">No SC/PWD discount</option>
              <option value="senior_citizen">Senior Citizen (20% + VAT exempt)</option>
              <option value="pwd">PWD (20% + VAT exempt)</option>
            </Select>
            {can('customers.view') && (
              <Button variant="secondary" size="sm" className="h-9" icon={<UserRound className="size-4" />} onClick={() => setCustomerPicker(true)}>
                {cart.customer ? cart.customer.name : 'Customer'}
              </Button>
            )}
          </div>
          {cart.saleDiscount.type !== 'none' && (
            <div className="grid grid-cols-2 gap-2">
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

          <dl className="space-y-1 text-sm">
            <Row label="Subtotal" value={totals?.subtotal} />
            {totals && Number(totals.vat_exemption_amount) > 0 && <Row label="Less VAT (SC/PWD)" value={`-${totals.vat_exemption_amount}`} />}
            {totals && Number(totals.discount_total) > 0 && <Row label="Discount" value={`-${totals.discount_total}`} />}
            <Row label="VAT (12%) included" value={totals?.vat_amount} muted />
            <div className="flex items-baseline justify-between pt-1">
              <dt className="font-semibold text-slate-900">Total</dt>
              <dd className="text-2xl font-semibold tabular-nums text-slate-900">{totals ? formatMoney(totals.total) : formatMoney('0.00')}</dd>
            </div>
          </dl>

          <Button
            size="lg"
            className="w-full"
            disabled={!totals || !quoteFresh || !quantitiesValid || !scPwdComplete || !!quote.error}
            onClick={() => {
              checkout.reset();
              setPaying(true);
            }}
          >
            Charge {totals ? formatMoney(totals.total) : ''}
          </Button>
          {outOfStock && <p className="text-center text-xs text-amber-700">Some items exceed available stock; checkout will be refused unless stock allows it.</p>}
        </div>
      </Card>

      <PaymentModal
        open={paying}
        total={totals?.total ?? '0.00'}
        busy={checkout.isPending}
        error={checkout.error}
        onClose={() => setPaying(false)}
        onSubmit={(payments) => checkout.mutate(payments)}
      />

      <Modal
        open={!!completed}
        onClose={() => setCompleted(null)}
        title={completed ? `Sale complete · Change ${formatMoney(completed.sale.change_due)}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Print receipt
            </Button>
            <Button onClick={() => setCompleted(null)}>New sale</Button>
          </>
        }
      >
        {completed && <ReceiptView receipt={completed.receipt} />}
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

      <CloseShiftModal session={session} open={closingShift} onClose={() => setClosingShift(false)} />
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
  const results = useTenantQuery<Paginated<Product>>('/products', { q: debounced || undefined, with_stock: 1, per_page: 30 });

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
    <Card className="flex min-h-0 flex-1 flex-col" padded={false}>
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <Input
            ref={inputRef}
            className="h-12 pl-11 text-base"
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
        <Button type="submit" size="lg" variant="secondary" icon={<Search className="size-4" />}>
          Add
        </Button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {results.isPending ? (
          <Spinner />
        ) : results.error ? (
          <ErrorBanner error={results.error} />
        ) : results.data?.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No products found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
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
                  className="flex flex-col items-start rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-teal-600 hover:shadow-sm"
                >
                  <span className="line-clamp-2 text-sm font-medium text-slate-900">{p.name}</span>
                  <span className="mt-0.5 text-xs text-slate-500">{p.sku}</span>
                  <span className="mt-2 flex w-full items-end justify-between">
                    <span className="font-semibold tabular-nums text-slate-900">{formatMoney(p.price)}</span>
                    {p.track_inventory && (
                      <span className={cx('text-xs', low ? 'text-red-600' : 'text-slate-500')}>{stock !== undefined ? `${formatQty(stock)} ${p.unit}` : '0'}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
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
      title={`Discount — ${line?.product.name ?? ''}`}
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as LineDiscount['type'])}>
              <option value="percent">Percent (%)</option>
              <option value="fixed">Amount (₱)</option>
            </Select>
          )}
        </Field>
        <Field label="Value">
          {(id) => <Input id={id} inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
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
    <Modal open={open} onClose={onClose} title="Select customer" footer={<Button variant="ghost" onClick={() => onPick(null)}>No customer</Button>}>
      <Input placeholder="Search name, phone or email" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
      <ul className="mt-3 divide-y divide-slate-100">
        {list.error && <ErrorBanner error={list.error} />}
        {list.data?.data.map((c) => (
          <li key={c.id}>
            <button className="w-full px-1 py-2 text-left text-sm hover:bg-slate-50" onClick={() => onPick({ id: c.id, name: c.name })}>
              <span className="font-medium text-slate-900">{c.name}</span> <span className="text-slate-500">{c.phone}</span>
            </button>
          </li>
        ))}
        {list.data?.data.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No customers found. Add them on the Customers page.</li>}
      </ul>
    </Modal>
  );
}

