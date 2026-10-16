import { Fragment, useState } from 'react';
import { AlertTriangle, Check, Info, Lock, Monitor, Play, ReceiptText, Store } from 'lucide-react';
import { useTenant } from '../../tenant/TenantProvider';
import { Badge, Button, ErrorBanner, Modal, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatMoney, titleCase } from '../../lib/format';
import { printDocument } from '../../lib/print';
import { useTenantMutation } from '../../lib/hooks';
import type { Register, RegisterSession, ShiftSummary } from '../../lib/types';

/** Shown on the POS when the cashier has no open shift. */
export function OpenShiftCard({ registers, branchName }: { registers: Register[]; branchName: string }) {
  const { branches, branch, setBranchId } = useTenant();
  const available = registers.filter((r) => r.is_active && !r.open_session);
  const [registerId, setRegisterId] = useState<number | ''>(available[0]?.id ?? '');
  const [float, setFloat] = useState('1000.00');
  const open = useTenantMutation<{ register_id: number; opening_float: string }>('POST', '/register-sessions', {
    success: 'Shift opened. Ready to sell.',
    toastErrors: false,
  });
  const fieldErr = (f: string) => (open.error instanceof ApiError ? open.error.field(f) : undefined);

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="overflow-hidden rounded-3xl bg-white shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5">
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-8 text-white">
          <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-sun-400/25 blur-3xl" />
          <span className="relative grid size-14 place-items-center rounded-2xl bg-white/15 text-sun-300 ring-1 ring-white/20"><Monitor className="size-7" /></span>
          <h1 className="relative mt-4 font-display text-2xl font-bold">Open a shift</h1>
          <p className="relative mt-1 text-sm text-brand-100/80">{branchName} · Count the cash in the drawer and enter it as the opening float. Sales are recorded against this shift until you close it.</p>
          {branches.length > 1 && (
            <div className="relative mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-100">Which branch are you selling at?</p>
              <div role="radiogroup" aria-label="Branch" className="flex flex-wrap gap-2">
                {branches.map((b) => {
                  const on = b.id === branch?.id;
                  return (
                    <button key={b.id} type="button" role="radio" aria-checked={on} onClick={() => setBranchId(b.id)}
                      className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition', on ? 'bg-sun-400 text-brand-900 ring-sun-300' : 'bg-white/10 text-white ring-white/20 hover:bg-white/20')}>
                      {on ? <Check className="size-3.5" /> : <Store className="size-3.5" />}{b.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-6">
          {open.error && !fieldErr('opening_float') && <ErrorBanner error={open.error} className="mb-4" />}
          {available.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600"><AlertTriangle className="size-6" /></span>
              <p className="mt-3 font-medium text-slate-800">No free register in this branch</p>
              <p className="mt-1 text-sm text-slate-500">{registers.length > 0 ? 'All registers already have an open shift.' : 'Ask a manager to add a register in Settings.'}</p>
            </div>
          ) : (
            <form
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (registerId) open.mutate({ register_id: registerId, opening_float: float || '0' });
              }}
            >
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Register</p>
                <div role="radiogroup" aria-label="Register" className="grid gap-2 sm:grid-cols-2">
                  {registers.filter((r) => r.is_active).map((r) => {
                    const busy = !!r.open_session;
                    const on = registerId === r.id;
                    return (
                      <button key={r.id} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => setRegisterId(r.id)}
                        className={cx('flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-50', on ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-white ring-slate-200 hover:bg-slate-50')}>
                        <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}><Monitor className="size-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-900">{r.name}</span>
                          <span className="block font-mono text-xs text-slate-400">{r.code}{busy && <span className="ml-1 font-sans text-amber-700">· in use</span>}</span>
                        </span>
                        {on && <Check className="size-4 text-brand-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="opening-float" className="block text-sm font-medium text-slate-700">Opening float <span className="font-normal text-slate-400">(cash already in the drawer)</span></label>
                <p className="mb-2 mt-0.5 text-xs text-slate-500">Count the bills and coins in the drawer before your first sale. It is change money, not sales. At closing, the system expects this amount plus your cash sales. Enter 0 if the drawer is empty.</p>
                <div className="flex h-14 items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
                  <span className="font-display text-2xl font-bold text-slate-400">₱</span>
                  <input id="opening-float" inputMode="decimal" placeholder="0.00" value={float}
                    onChange={(e) => {
                      // Digits with up to 2 decimals, at most ₱9,999,999.99 (the server limit).
                      const v = e.target.value.replace(/[^\d.]/g, '');
                      if (/^\d{0,7}(\.\d{0,2})?$/.test(v)) setFloat(v);
                    }}
                    className="h-full w-full bg-transparent px-2 font-display text-2xl font-bold tabular-nums outline-none placeholder:text-slate-300" />
                </div>
                {fieldErr('opening_float') && <p className="mt-1 text-xs text-red-600">{fieldErr('opening_float')}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {['500.00', '1000.00', '2000.00', '5000.00'].map((v) => (
                    <button key={v} type="button" onClick={() => setFloat(v)} className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition', float === v ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{formatMoney(v)}</button>
                  ))}
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full" icon={<Play className="size-4" />} loading={open.isPending} disabled={!registerId}>
                Open shift and start selling
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function ShiftSummaryView({ summary }: { summary: ShiftSummary }) {
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between py-1 text-sm ${strong ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  const diff = summary.cash.cash_difference;
  return (
    <div className="space-y-4">
      <div>
        {row('Sales', String(summary.sales_count))}
        {row('Voided sales', String(summary.voided_count))}
        {row('Gross sales', formatMoney(summary.gross_sales), true)}
        {row('Discounts', formatMoney(summary.discounts))}
        {row('VAT', formatMoney(summary.vat_amount))}
        {row('Refunds', formatMoney(summary.refunds))}
      </div>
      <div className="border-t border-slate-100 pt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">Payments</p>
        {summary.payments_by_method.length === 0 && <p className="text-sm text-slate-500">No payments.</p>}
        {summary.payments_by_method.map((p) => <Fragment key={p.method}>{row(`${titleCase(p.method)} (${p.count})`, formatMoney(p.amount))}</Fragment>)}
      </div>
      <div className="border-t border-slate-100 pt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">Cash drawer</p>
        {row('Opening float', formatMoney(summary.cash.opening_float))}
        {row('+ Cash sales', formatMoney(summary.cash.cash_sales))}
        {row('− Cash refunds', formatMoney(summary.cash.cash_refunds))}
        {row('Expected cash', formatMoney(summary.cash.expected_cash), true)}
        {summary.cash.counted_cash !== null && row('Counted cash', formatMoney(summary.cash.counted_cash), true)}
        {diff !== null && (
          <div className="flex items-center justify-between py-1 text-sm">
            <span className="text-slate-600">Difference</span>
            <Badge status={Number(diff) === 0 ? 'completed' : 'voided'}>{formatMoney(diff)}</Badge>
          </div>
        )}
      </div>
    </div>
  );
}

/** Z reading of a shift that was just closed, shown after the POS has already switched back to "Open a shift". */
export function ZReadingModal({ session, onClose }: { session: RegisterSession; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Shift closed — Z reading"
      icon={ReceiptText}
      description="Print this summary for your records."
      footer={
        <>
          <Button variant="secondary" onClick={() => printDocument()}>Print</Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {session.summary ? (
        <div className="print-area" data-print-width="80mm">
          <ShiftSummaryView summary={session.summary} />
        </div>
      ) : (
        <p className="text-sm text-slate-600">Shift closed.</p>
      )}
    </Modal>
  );
}

export function CloseShiftModal({ session, open, onClose, onClosed }: { session: RegisterSession; open: boolean; onClose: () => void; onClosed?: (session: RegisterSession) => void }) {
  const [counted, setCounted] = useState('');
  const [closed, setClosed] = useState<RegisterSession | null>(null);
  const close = useTenantMutation<{ counted_cash: string }, { data: RegisterSession }>('POST', `/register-sessions/${session.id}/close`, {
    success: 'Shift closed.',
    // With onClosed the caller shows the Z reading (the POS screen changes as soon as the shift closes).
    onSuccess: (r) => (onClosed ? onClosed(r.data) : setClosed(r.data)),
    toastErrors: false,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={closed ? 'Shift closed — Z reading' : 'Close shift'}
      icon={closed ? ReceiptText : Lock}
      description={closed ? 'Print this summary for your records.' : 'Count the drawer before you hand over.'}
      footer={
        closed ? (
          <>
            <Button variant="secondary" onClick={() => printDocument()}>
              Print
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" loading={close.isPending} disabled={counted === ''} onClick={() => close.mutate({ counted_cash: counted })}>
              Close shift
            </Button>
          </>
        )
      }
    >
      {closed?.summary ? (
        <div className="print-area" data-print-width="80mm">
          <ShiftSummaryView summary={closed.summary} />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-brand-50/60 p-3 text-sm text-slate-700 ring-1 ring-brand-100"><Info className="mt-0.5 size-4 shrink-0 text-brand-600" />Count all cash in the drawer. The system compares it with the expected amount (float + cash sales − cash refunds).</p>
          <ErrorBanner error={close.error} />
          <div>
            <label htmlFor="counted-cash" className="mb-2 block text-sm font-medium text-slate-700">Counted cash</label>
            <div className="flex h-14 items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
              <span className="font-display text-2xl font-bold text-slate-400">₱</span>
              <input id="counted-cash" inputMode="decimal" autoFocus placeholder="0.00" value={counted} onChange={(e) => setCounted(e.target.value)} className="h-full w-full bg-transparent px-2 font-display text-2xl font-bold tabular-nums outline-none" />
            </div>
            {close.error instanceof ApiError && close.error.field('counted_cash') && <p className="mt-1 text-xs text-red-600">{close.error.field('counted_cash')}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
