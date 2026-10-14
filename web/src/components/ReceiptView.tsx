import { formatMoney, formatQty, titleCase } from '../lib/format';
import type { Receipt } from '../lib/types';

/** Thermal-receipt style rendering of the backend's receipt document. Printable via window.print(). */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const t = receipt.totals;
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="print-area mx-auto w-full max-w-xs bg-white font-mono text-[12px] leading-snug text-slate-900">
      <div className="text-center">
        <p className="text-sm font-bold">{receipt.header.business_name}</p>
        {receipt.header.legal_name && <p>{receipt.header.legal_name}</p>}
        <p>{receipt.header.branch}</p>
        {receipt.header.address && <p>{receipt.header.address}</p>}
        {receipt.header.tin && (
          <p>
            {receipt.header.vat_status} TIN: {receipt.header.tin}
          </p>
        )}
      </div>
      <hr className="my-2 border-dashed border-slate-400" />
      <p>Receipt #: {receipt.receipt_number}</p>
      <p>Date: {receipt.date}</p>
      {receipt.cashier && <p>Cashier: {receipt.cashier}</p>}
      {receipt.customer && <p>Customer: {receipt.customer.name}</p>}
      {receipt.reprint && <p className="font-bold">*** REPRINT ***</p>}
      {receipt.status === 'voided' && <p className="font-bold">*** VOIDED ***</p>}
      <hr className="my-2 border-dashed border-slate-400" />
      {receipt.lines.map((line, i) => (
        <div key={i} className="mb-1">
          <p>{line.name}</p>
          <div className="flex justify-between pl-2">
            <span>
              {formatQty(line.quantity)} × {formatMoney(line.unit_price, '')}
            </span>
            <span className="tabular-nums">
              {formatMoney(line.amount, '')} {line.tax_code}
            </span>
          </div>
          {Number(line.discount) > 0 && <p className="pl-2">Less discount -{formatMoney(line.discount, '')}</p>}
        </div>
      ))}
      <hr className="my-2 border-dashed border-slate-400" />
      {row('Subtotal', formatMoney(t.subtotal))}
      {Number(t.less_vat_sc_pwd) > 0 && row('Less VAT (SC/PWD)', `-${formatMoney(t.less_vat_sc_pwd)}`)}
      {Number(t.discount) > 0 && row('Discount', `-${formatMoney(t.discount)}`)}
      {row('TOTAL', formatMoney(t.total), true)}
      {receipt.payments.map((p, i) => (
        <div key={i}>{row(`${titleCase(p.method)}${p.reference_number ? ` (${p.reference_number})` : ''}`, formatMoney(p.tendered))}</div>
      ))}
      {row('Change', formatMoney(receipt.change), true)}
      <hr className="my-2 border-dashed border-slate-400" />
      {row('VATable Sales', formatMoney(t.vatable_sales))}
      {row('VAT Amount', formatMoney(t.vat_amount))}
      {row('VAT-Exempt Sales', formatMoney(t.vat_exempt_sales))}
      {row('Zero-Rated Sales', formatMoney(t.zero_rated_sales))}
      {receipt.statutory_discount && (
        <>
          <hr className="my-2 border-dashed border-slate-400" />
          <p>{titleCase(receipt.statutory_discount.type)} ID: {receipt.statutory_discount.id_number}</p>
          <p>Name: {receipt.statutory_discount.holder_name}</p>
          <p>Signature: ____________________</p>
        </>
      )}
      <hr className="my-2 border-dashed border-slate-400" />
      <p className="text-center">Thank you for shopping!</p>
      {receipt.footer && <p className="mt-1 text-center text-[10px]">{receipt.footer}</p>}
    </div>
  );
}
