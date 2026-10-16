import { Banknote, CreditCard, Landmark, MoreHorizontal, Plus, Smartphone, Trash2, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, ErrorBanner, Input, Modal, cx } from '../../components/ui';
import { formatMoney, fromCents, toCents, titleCase } from '../../lib/format';
import type { PaymentMethod } from '../../lib/types';

export interface PaymentLine {
  method: PaymentMethod;
  amount: string;
  reference_number: string;
}

const METHODS: PaymentMethod[] = ['cash', 'gcash', 'maya', 'card', 'bank_transfer', 'other'];
const METHOD_ICON: Record<PaymentMethod, LucideIcon> = { cash: Banknote, gcash: Smartphone, maya: Smartphone, card: CreditCard, bank_transfer: Landmark, other: MoreHorizontal };
const methodLabel = (m: PaymentMethod) => (m === 'gcash' ? 'GCash' : m === 'bank_transfer' ? 'Bank' : titleCase(m));

/** Splits change into Philippine bills and coins, largest first, e.g. ₱910 → 1×500, 2×200, 1×10. */
function changeBreakdown(cents: number): [number, number][] {
  const units = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25, 0.05, 0.01];
  let left = cents;
  const out: [number, number][] = [];
  for (const u of units) {
    const c = Math.round(u * 100);
    const n = Math.floor(left / c);
    if (n > 0) {
      out.push([u, n]);
      left -= n * c;
    }
  }
  return out;
}

/**
 * Collect tenders. Change shown here is a preview; the server re-validates every amount
 * (non-cash cannot exceed the total, change only from cash).
 */
export function PaymentModal({
  open,
  total,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  total: string;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payments: PaymentLine[]) => void;
}) {
  const [lines, setLines] = useState<PaymentLine[]>([{ method: 'cash', amount: '', reference_number: '' }]);

  useEffect(() => {
    // Cash starts empty: the cashier types what the customer handed over (or taps a bill / Exact).
    if (open) setLines([{ method: 'cash', amount: '', reference_number: '' }]);
  }, [open, total]);

  const totalCents = toCents(total);
  const tenderedCents = lines.reduce((sum, l) => sum + (Number.isNaN(toCents(l.amount)) ? 0 : toCents(l.amount)), 0);
  const changeCents = tenderedCents - totalCents;
  const invalid = lines.some((l) => Number.isNaN(toCents(l.amount)) || toCents(l.amount) <= 0);

  // Exact amount, the next round amounts, and every common bill (₱20–₱1,000) the customer could hand over.
  const quickCash = useMemo(() => {
    const due = totalCents / 100;
    const notes = [20, 50, 100, 200, 500, 1000];
    const rounded = new Set<number>();
    for (const n of notes) rounded.add(Math.ceil(due / n) * n);
    const bills = notes.filter((n) => n > due);
    const big = due >= 1000 ? [Math.ceil(due / 1000) * 1000 + 1000] : [];
    return [...new Set([Math.ceil(due), ...rounded, ...bills, ...big])].filter((v) => v >= due).sort((a, b) => a - b).slice(0, 8);
  }, [totalCents]);
  const cashCents = lines.filter((l) => l.method === 'cash').reduce((s, l) => s + (toCents(l.amount) || 0), 0);
  const cashIndex = lines.findIndex((l) => l.method === 'cash');
  const cashLine = cashIndex >= 0 ? lines[cashIndex] : undefined;
  const otherCents = lines.reduce((s, l, idx) => (idx === cashIndex ? s : s + (toCents(l.amount) || 0)), 0);
  const canComplete = !invalid && changeCents >= 0;
  const complete = () => {
    if (canComplete) onSubmit(lines.map((l) => ({ ...l, amount: fromCents(toCents(l.amount)) })));
  };

  const update = (i: number, patch: Partial<PaymentLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Payment"
      icon={Wallet}
      description="Split across methods if the customer pays more than one way."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            size="lg"
            loading={busy}
            disabled={!canComplete}
            onClick={complete}
          >
            {changeCents > 0 ? `Complete sale · Change ${formatMoney(fromCents(changeCents))}` : 'Complete sale'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 px-5 py-4 text-white shadow-md">
          <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-sun-400/20 blur-xl" />
          <p className="relative text-[11px] font-semibold uppercase tracking-wider text-brand-100">Amount due</p>
          <p className="relative font-display text-4xl font-bold tabular-nums">{formatMoney(total)}</p>
        </div>

        <ErrorBanner error={error} />

        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {METHODS.map((m) => {
                  const Icon = METHOD_ICON[m];
                  const on = line.method === m;
                  return (
                    <button key={m} type="button" role="radio" aria-checked={on} onClick={() => update(i, { method: m })}
                      className={cx('flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-semibold ring-1 transition', on ? 'bg-white text-brand-800 ring-2 ring-brand-500' : 'bg-white/60 text-slate-500 ring-slate-200 hover:bg-white')}>
                      <Icon className={cx('size-4', on ? 'text-brand-600' : 'text-slate-400')} />{methodLabel(m)}
                    </button>
                  );
                })}
              </div>
              {/* The main cash amount is entered in the calculator below; other tenders are entered here. */}
              {i !== cashIndex && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-48 flex-1 flex-col gap-1">
                    <span className="text-xs font-semibold text-slate-600">{line.method === 'cash' ? 'Cash amount' : `Amount paid by ${methodLabel(line.method)}`}</span>
                    <span className="flex h-12 items-center rounded-xl border border-slate-200 bg-white px-3 shadow-sm transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
                      <span className="font-display text-lg font-bold text-slate-400">₱</span>
                      <input
                        className="h-full w-full bg-transparent px-2 text-right font-display text-xl font-bold tabular-nums text-slate-900 outline-none"
                        inputMode="decimal"
                        value={line.amount}
                        onChange={(e) => update(i, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                        aria-label="Amount"
                        autoFocus={cashIndex < 0 && i === 0}
                        onFocus={(e) => e.target.select()}
                      />
                    </span>
                  </label>
                  {line.method !== 'cash' && (
                    <Input
                      className="h-12 w-40 flex-1"
                      placeholder="Reference no."
                      value={line.reference_number}
                      onChange={(e) => update(i, { reference_number: e.target.value })}
                      aria-label="Reference number"
                    />
                  )}
                  {lines.length > 1 && (
                    <button type="button" className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove payment">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              )}
              {i === cashIndex && lines.length > 1 && (
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Cash: enter the amount below.</span>
                  <button type="button" className="font-medium text-rose-600 hover:underline" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>Remove</button>
                </div>
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setLines((ls) => [...ls, { method: 'gcash', amount: fromCents(Math.max(totalCents - tenderedCents, 0)), reference_number: '' }])}
          >
            Split payment
          </Button>
        </div>

        {/* Cash calculator: what the customer gave → change to give back, updated as you type. */}
        {cashLine ? (
          <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
            <div className="space-y-3 bg-white p-4">
              <label htmlFor="cash-given" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>
                How much did the customer give?
              </label>
              <div className="flex h-16 items-center rounded-2xl border-2 border-slate-200 bg-white px-4 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
                <span className="font-display text-3xl font-bold text-slate-400">₱</span>
                <input
                  id="cash-given"
                  autoFocus
                  inputMode="decimal"
                  placeholder="0.00"
                  value={cashLine.amount}
                  onChange={(e) => update(cashIndex, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                  onKeyDown={(e) => { if (e.key === 'Enter') complete(); }}
                  onFocus={(e) => e.target.select()}
                  className="h-full w-full bg-transparent px-2 text-right font-display text-3xl font-bold tabular-nums text-slate-900 outline-none placeholder:text-slate-300"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {quickCash.map((amount, idx) => (
                  <button
                    key={amount}
                    type="button"
                    className={cx(
                      'h-10 rounded-xl font-display text-sm font-bold tabular-nums ring-1 transition hover:-translate-y-0.5 active:scale-95',
                      cashCents + otherCents === amount * 100 && cashLine.amount !== '' ? 'bg-brand-700 text-white ring-brand-700' : 'bg-slate-50 text-slate-800 ring-slate-200 hover:bg-white hover:ring-brand-300',
                    )}
                    onClick={() => update(cashIndex, { amount: fromCents(Math.max(amount * 100 - otherCents, 0)) })}
                  >
                    {idx === 0 && amount * 100 === totalCents ? 'Exact' : `₱${amount.toLocaleString('en-PH')}`}
                  </button>
                ))}
              </div>
            </div>

            <div className={cx('border-t px-4 py-4 transition', cashLine.amount === '' ? 'border-slate-100 bg-slate-50' : changeCents >= 0 ? 'border-emerald-100 bg-emerald-50' : 'border-rose-100 bg-rose-50')}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className={cx('grid size-6 place-items-center rounded-full text-xs font-bold text-white', changeCents >= 0 && cashLine.amount !== '' ? 'bg-emerald-600' : 'bg-slate-400')}>2</span>
                {cashLine.amount === '' ? 'Change to give' : changeCents >= 0 ? 'Change to give' : 'Not enough. Still to pay'}
              </div>
              <div className="mt-1 flex items-end justify-between gap-3">
                <span className="text-xs text-slate-500">
                  {formatMoney(fromCents(tenderedCents))} given − {formatMoney(total)} due
                </span>
                <span className={cx('font-display text-4xl font-bold tabular-nums', cashLine.amount === '' ? 'text-slate-300' : changeCents >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
                  {cashLine.amount === '' ? formatMoney('0.00') : formatMoney(fromCents(Math.abs(changeCents)))}
                </span>
              </div>
              {cashLine.amount !== '' && changeCents > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-emerald-800">
                  <span className="font-medium">Give back:</span>
                  {changeBreakdown(changeCents).map(([note, n]) => (
                    <span key={note} className="rounded-md bg-white px-1.5 py-0.5 font-semibold tabular-nums ring-1 ring-emerald-200">{n} × ₱{note >= 1 ? note.toLocaleString('en-PH') : note.toFixed(2)}</span>
                  ))}
                </p>
              )}
              {cashLine.amount === '' && <p className="mt-1 text-xs text-slate-500">Type the amount above. The change appears here automatically.</p>}
            </div>
          </div>
        ) : (
          <div className={cx('flex items-center justify-between rounded-2xl px-5 py-4 ring-1', changeCents >= 0 ? 'bg-emerald-50 ring-emerald-200' : 'bg-rose-50 ring-rose-200')}>
            <span className={cx('text-sm font-semibold', changeCents >= 0 ? 'text-emerald-800' : 'text-rose-700')}>{changeCents >= 0 ? 'Fully paid' : 'Still to pay'}</span>
            <span className={cx('font-display text-2xl font-bold tabular-nums', changeCents >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{formatMoney(fromCents(Math.abs(Math.min(changeCents, 0))))}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
