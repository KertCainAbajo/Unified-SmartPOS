import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, ErrorBanner, Input, Modal, Select } from '../../components/ui';
import { formatMoney, fromCents, toCents, titleCase } from '../../lib/format';
import type { PaymentMethod } from '../../lib/types';

export interface PaymentLine {
  method: PaymentMethod;
  amount: string;
  reference_number: string;
}

const METHODS: PaymentMethod[] = ['cash', 'gcash', 'maya', 'card', 'bank_transfer', 'other'];

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
    if (open) setLines([{ method: 'cash', amount: total, reference_number: '' }]);
  }, [open, total]);

  const totalCents = toCents(total);
  const tenderedCents = lines.reduce((sum, l) => sum + (Number.isNaN(toCents(l.amount)) ? 0 : toCents(l.amount)), 0);
  const changeCents = tenderedCents - totalCents;
  const invalid = lines.some((l) => Number.isNaN(toCents(l.amount)) || toCents(l.amount) <= 0);

  const quickCash = useMemo(() => {
    const due = totalCents / 100;
    const notes = [20, 50, 100, 200, 500, 1000];
    const options = new Set<number>([Math.ceil(due)]);
    for (const n of notes) options.add(Math.ceil(due / n) * n);
    return [...options].filter((v) => v >= due).sort((a, b) => a - b).slice(0, 5);
  }, [totalCents]);

  const update = (i: number, patch: Partial<PaymentLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Payment"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            size="lg"
            loading={busy}
            disabled={invalid || changeCents < 0}
            onClick={() => onSubmit(lines.map((l) => ({ ...l, amount: fromCents(toCents(l.amount)) })))}
          >
            Complete sale
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-900 px-4 py-3 text-white">
          <p className="text-xs uppercase tracking-wide text-slate-400">Amount due</p>
          <p className="text-3xl font-semibold tabular-nums">{formatMoney(total)}</p>
        </div>

        <ErrorBanner error={error} />

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select className="w-36" value={line.method} onChange={(e) => update(i, { method: e.target.value as PaymentMethod })} aria-label="Payment method">
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m === 'gcash' ? 'GCash' : titleCase(m)}
                  </option>
                ))}
              </Select>
              <Input
                className="w-32 flex-1 text-right tabular-nums"
                inputMode="decimal"
                value={line.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                aria-label="Amount"
                onFocus={(e) => e.target.select()}
              />
              {line.method !== 'cash' && (
                <Input
                  className="w-40 flex-1"
                  placeholder="Reference no."
                  value={line.reference_number}
                  onChange={(e) => update(i, { reference_number: e.target.value })}
                  aria-label="Reference number"
                />
              )}
              {lines.length > 1 && (
                <button type="button" className="p-2 text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove payment">
                  <Trash2 className="size-4" />
                </button>
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

        {lines.some((l) => l.method === 'cash') && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Quick cash</p>
            <div className="flex flex-wrap gap-2">
              {quickCash.map((amount) => (
                <Button
                  key={amount}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const cashIndex = lines.findIndex((l) => l.method === 'cash');
                    const others = lines.reduce((s, l, idx) => (idx === cashIndex ? s : s + (toCents(l.amount) || 0)), 0);
                    update(cashIndex, { amount: fromCents(Math.max(amount * 100 - others, 0)) });
                  }}
                >
                  ₱{amount.toLocaleString('en-PH')}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
          <span className="text-sm text-slate-600">{changeCents >= 0 ? 'Change' : 'Remaining'}</span>
          <span className={`text-xl font-semibold tabular-nums ${changeCents >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {formatMoney(fromCents(Math.abs(changeCents)))}
          </span>
        </div>
      </div>
    </Modal>
  );
}
