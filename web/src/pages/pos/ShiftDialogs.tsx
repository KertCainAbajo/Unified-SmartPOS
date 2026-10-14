import { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, Select } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatMoney, titleCase } from '../../lib/format';
import { useTenantMutation } from '../../lib/hooks';
import type { Register, RegisterSession, ShiftSummary } from '../../lib/types';

/** Shown on the POS when the cashier has no open shift. */
export function OpenShiftCard({ registers, branchName }: { registers: Register[]; branchName: string }) {
  const available = registers.filter((r) => r.is_active && !r.open_session);
  const [registerId, setRegisterId] = useState<number | ''>(available[0]?.id ?? '');
  const [float, setFloat] = useState('1000.00');
  const open = useTenantMutation<{ register_id: number; opening_float: string }>('POST', '/register-sessions', {
    success: 'Shift opened. Ready to sell.',
    toastErrors: false,
  });
  const fieldErr = (f: string) => (open.error instanceof ApiError ? open.error.field(f) : undefined);

  return (
    <Card title={`Open a shift — ${branchName}`} className="mx-auto max-w-lg">
      <p className="mb-4 text-sm text-slate-600">Count the cash in the drawer and enter it as the opening float. Sales are recorded against this shift until you close it.</p>
      {open.error && !fieldErr('opening_float') && <ErrorBanner error={open.error} className="mb-4" />}
      {available.length === 0 ? (
        <p className="text-sm text-slate-600">
          No free register in this branch. {registers.length > 0 ? 'All registers already have an open shift.' : 'Ask a manager to add a register in Settings.'}
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (registerId) open.mutate({ register_id: registerId, opening_float: float });
          }}
        >
          <Field label="Register">
            {(id) => (
              <Select id={id} value={registerId} onChange={(e) => setRegisterId(Number(e.target.value))}>
                {available.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Opening float (₱)" error={fieldErr('opening_float')}>
            {(id) => <Input id={id} inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={open.isPending}>
            Open shift
          </Button>
        </form>
      )}
    </Card>
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
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Payments</p>
        {summary.payments_by_method.length === 0 && <p className="text-sm text-slate-500">No payments.</p>}
        {summary.payments_by_method.map((p) => row(`${titleCase(p.method)} (${p.count})`, formatMoney(p.amount)))}
      </div>
      <div className="border-t border-slate-100 pt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Cash drawer</p>
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

export function CloseShiftModal({ session, open, onClose }: { session: RegisterSession; open: boolean; onClose: () => void }) {
  const [counted, setCounted] = useState('');
  const [closed, setClosed] = useState<RegisterSession | null>(null);
  const close = useTenantMutation<{ counted_cash: string }, { data: RegisterSession }>('POST', `/register-sessions/${session.id}/close`, {
    success: 'Shift closed.',
    onSuccess: (r) => setClosed(r.data),
    toastErrors: false,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={closed ? 'Shift closed — Z reading' : 'Close shift'}
      footer={
        closed ? (
          <>
            <Button variant="secondary" onClick={() => window.print()}>
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
        <div className="print-area">
          <ShiftSummaryView summary={closed.summary} />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Count all cash in the drawer. The system compares it with the expected amount (float + cash sales − cash refunds).</p>
          <ErrorBanner error={close.error} />
          <Field label="Counted cash (₱)" error={close.error instanceof ApiError ? close.error.field('counted_cash') : undefined}>
            {(id) => <Input id={id} inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />}
          </Field>
        </div>
      )}
    </Modal>
  );
}
