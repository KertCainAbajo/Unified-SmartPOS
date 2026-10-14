import type { Product } from './types';

/**
 * POS cart state. Holds only what the cashier chose (products, quantities, discount requests).
 * Prices and totals always come from the server quote; nothing here is authoritative.
 */

export interface LineDiscount {
  type: 'percent' | 'fixed';
  value: string;
}

export interface CartLine {
  key: string;
  product: Pick<Product, 'id' | 'sku' | 'name' | 'unit' | 'price' | 'allow_decimal_quantity' | 'track_inventory'>;
  quantity: string;
  discount?: LineDiscount;
}

export type SaleDiscountType = 'none' | 'senior_citizen' | 'pwd';

export interface CartState {
  lines: CartLine[];
  saleDiscount: { type: SaleDiscountType; idNumber: string; holderName: string };
  customer: { id: number; name: string } | null;
}

export const emptyCart: CartState = {
  lines: [],
  saleDiscount: { type: 'none', idNumber: '', holderName: '' },
  customer: null,
};

export type CartAction =
  | { type: 'add'; product: CartLine['product']; quantity?: string }
  | { type: 'setQuantity'; key: string; quantity: string }
  | { type: 'increment'; key: string; by: 1 | -1 }
  | { type: 'remove'; key: string }
  | { type: 'setLineDiscount'; key: string; discount?: LineDiscount }
  | { type: 'setSaleDiscount'; discount: CartState['saleDiscount'] }
  | { type: 'setCustomer'; customer: CartState['customer'] }
  | { type: 'clear' };

function addQuantities(a: string, b: string): string {
  // Quantities have at most 3 decimals; work in thousandths to avoid float drift.
  const toMilli = (v: string) => Math.round(Number(v) * 1000);
  const sum = toMilli(a) + toMilli(b);
  return (sum / 1000).toString();
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const quantity = action.quantity ?? '1';
      // Merge into an existing undiscounted line for the same product.
      const existing = state.lines.find((l) => l.product.id === action.product.id && !l.discount);
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((l) => (l.key === existing.key ? { ...l, quantity: addQuantities(l.quantity, quantity) } : l)),
        };
      }
      const key = `${action.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return { ...state, lines: [...state.lines, { key, product: action.product, quantity }] };
    }
    case 'setQuantity':
      return { ...state, lines: state.lines.map((l) => (l.key === action.key ? { ...l, quantity: action.quantity } : l)) };
    case 'increment': {
      const lines = state.lines
        .map((l) => (l.key === action.key ? { ...l, quantity: addQuantities(l.quantity, String(action.by)) } : l))
        .filter((l) => Number(l.quantity) > 0);
      return { ...state, lines };
    }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };
    case 'setLineDiscount':
      return { ...state, lines: state.lines.map((l) => (l.key === action.key ? { ...l, discount: action.discount } : l)) };
    case 'setSaleDiscount': {
      // Statutory SC/PWD discounts cannot be combined with manual line discounts.
      const lines = action.discount.type === 'none' ? state.lines : state.lines.map((l) => ({ ...l, discount: undefined }));
      return { ...state, lines, saleDiscount: action.discount };
    }
    case 'setCustomer':
      return { ...state, customer: action.customer };
    case 'clear':
      return emptyCart;
  }
}

export function isValidQuantity(line: CartLine): boolean {
  const pattern = line.product.allow_decimal_quantity ? /^\d+(\.\d{1,3})?$/ : /^\d+$/;
  return pattern.test(line.quantity) && Number(line.quantity) > 0;
}

/** Request body shared by POST /sales/quote and POST /sales. */
export function cartPayload(state: CartState, registerId: number) {
  return {
    register_id: registerId,
    items: state.lines.map((l) => ({
      product_id: l.product.id,
      quantity: l.quantity,
      ...(l.discount ? { discount: { type: l.discount.type, value: l.discount.value } } : {}),
    })),
    ...(state.saleDiscount.type !== 'none'
      ? { discount: { type: state.saleDiscount.type, id_number: state.saleDiscount.idNumber, holder_name: state.saleDiscount.holderName } }
      : {}),
    ...(state.customer ? { customer_id: state.customer.id } : {}),
  };
}
