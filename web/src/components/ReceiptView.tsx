import type { ReactNode } from 'react';
import { formatMoney, formatQty, titleCase } from '../lib/format';
import type { Receipt } from '../lib/types';
import { platformInfo } from '../lib/platformInfo';

const money = (v: string) => formatMoney(v, '');
const methodLabel = (m: string) => (m === 'gcash' ? 'GCASH' : m === 'bank_transfer' ? 'BANK TRANSFER' : m.toUpperCase());

/** "2026-10-16 19:34:53" → ["10/16/2026", "07:34:53 PM"] as printed on mall receipts. */
function splitDate(value: string): [string, string] {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return [value, ''];
  const [, y, mo, d, hh, mm, ss = '00'] = m;
  const h = Number(hh);
  return [`${mo}/${d}/${y}`, `${String(h % 12 || 12).padStart(2, '0')}:${mm}:${ss} ${h < 12 ? 'AM' : 'PM'}`];
}

const Dash = () => <div className="my-1.5 border-t border-dashed border-black" />;

function Line({ left, right, bold, big }: { left: ReactNode; right?: ReactNode; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''} ${big ? 'text-[14px]' : ''}`}>
      <span className="min-w-0">{left}</span>
      {right !== undefined && <span className="shrink-0 whitespace-nowrap tabular-nums">{right}</span>}
    </div>
  );
}

/**
 * Mall-style thermal receipt (80 mm roll, ~42 columns): plain monospaced text, centred header, dashed rules and
 * right-aligned amounts. Printed via printDocument(), which sizes the page to the roll.
 */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const t = receipt.totals;
  const h = receipt.header;
  const [date, time] = splitDate(receipt.date);
  const count = receipt.lines.reduce((s, l) => s + Number(l.quantity), 0);
  const codes = [...new Set(receipt.lines.map((l) => l.tax_code).filter(Boolean))];

  return (
    <div
      data-print-width="80mm"
      className="print-area mx-auto w-[76mm] max-w-full bg-white px-[3mm] py-[4mm] font-[Consolas,'Courier_New',monospace] text-[11px] leading-[1.35] text-black shadow-md ring-1 ring-slate-200"
    >
      {/* Header */}
      <div className="text-center">
        <p className="text-[14px] font-bold uppercase">{h.business_name}</p>
        {h.legal_name && <p>{h.legal_name}</p>}
        <p>{h.branch}</p>
        {h.address && <p>{h.address}</p>}
        {h.phone && <p>Tel. No.: {h.phone}</p>}
        {h.tin && <p>{h.vat_status.toUpperCase()} TIN: {h.tin}</p>}
        <p className="mt-2 font-bold">SALES INVOICE</p>
        {platformInfo.demo && <p className="mt-1 border border-dashed border-current px-1 py-0.5 text-[11px] font-bold">DEMO · NOT AN OFFICIAL RECEIPT</p>}
        {receipt.reprint && <p className="font-bold">** REPRINT **</p>}
        {receipt.status === 'voided' && <p className="text-[13px] font-bold">*** VOID ***</p>}
      </div>

      <Dash />
      <Line left={`SI No.: ${receipt.receipt_number}`} />
      <Line left={`Date: ${date}`} right={time} />
      {receipt.cashier && <Line left={`Cashier: ${receipt.cashier}`} />}
      {receipt.customer && <Line left={`Customer: ${receipt.customer.name}`} />}
      <Dash />

      {/* Items */}
      {receipt.lines.map((line, i) => (
        <div key={i}>
          <p className="uppercase">{line.name}</p>
          <Line left={<span className="pl-3">{formatQty(line.quantity)} @ {money(line.unit_price)}</span>} right={`${money(line.amount)} ${line.tax_code}`} />
          {Number(line.discount) > 0 && <Line left={<span className="pl-3">LESS: DISCOUNT</span>} right={`-${money(line.discount)}`} />}
        </div>
      ))}
      <Dash />
      <p className="text-center">{formatQty(String(count))} Item(s)</p>

      {/* Totals */}
      <Line left="SUBTOTAL" right={money(t.subtotal)} />
      {Number(t.less_vat_sc_pwd) > 0 && <Line left="LESS: VAT (SC/PWD)" right={`-${money(t.less_vat_sc_pwd)}`} />}
      {Number(t.discount) > 0 && <Line left="LESS: DISCOUNT" right={`-${money(t.discount)}`} />}
      <Line left="TOTAL" right={money(t.total)} bold big />
      {receipt.payments.map((p, i) => (
        <div key={i}>
          <Line left={methodLabel(p.method)} right={money(p.tendered)} />
          {p.reference_number && <Line left={<span className="pl-3">REF: {p.reference_number}</span>} />}
        </div>
      ))}
      <Line left="CHANGE" right={money(receipt.change)} bold />
      <Dash />

      {/* VAT summary */}
      <Line left="VATable Sales" right={money(t.vatable_sales)} />
      <Line left="VAT Amount" right={money(t.vat_amount)} />
      <Line left="VAT-Exempt Sales" right={money(t.vat_exempt_sales)} />
      <Line left="Zero-Rated Sales" right={money(t.zero_rated_sales)} />
      {codes.length > 0 && (
        <p className="mt-0.5">{codes.map((c) => `${c}-${c === 'V' ? 'VATable' : c === 'E' ? 'VAT Exempt' : c === 'Z' ? 'Zero Rated' : c}`).join('  ')}</p>
      )}

      {receipt.statutory_discount && (
        <>
          <Dash />
          <p className="font-bold uppercase">{titleCase(receipt.statutory_discount.type)} DISCOUNT</p>
          <Line left={`ID No.: ${receipt.statutory_discount.id_number}`} />
          <Line left={`Name: ${receipt.statutory_discount.holder_name}`} />
          <Line left="Signature: ______________________" />
        </>
      )}

      <Dash />
      <Line left={`Customer Name: ${receipt.customer?.name ?? '________________'}`} />
      <Line left={`Address: ${receipt.customer?.address ?? '______________________'}`} />
      <Line left={`TIN: ${receipt.customer?.tin ?? '__________________________'}`} />
      <Line left="Business Style: _______________" />
      <Dash />

      {/* Footer */}
      <div className="text-center">
        <p className="font-bold">THANK YOU FOR SHOPPING!</p>
        <p>Please come again.</p>
        {receipt.footer && <p className="mt-1 whitespace-pre-line">{receipt.footer}</p>}
        <p className="mt-2">{receipt.receipt_number}</p>
        <p>{date} {time}</p>
      </div>
    </div>
  );
}
