import { describe, expect, it } from 'vitest';
import { cartPayload, cartReducer, emptyCart, isValidQuantity, type CartLine } from '../cart';

const coke: CartLine['product'] = { id: 1, sku: 'COKE', name: 'Coke', unit: 'pc', price: '65.00', allow_decimal_quantity: false, track_inventory: true };
const rice: CartLine['product'] = { id: 2, sku: 'RICE', name: 'Rice', unit: 'kg', price: '62.00', allow_decimal_quantity: true, track_inventory: true };

describe('cartReducer', () => {
  it('merges repeated scans into one line', () => {
    let state = cartReducer(emptyCart, { type: 'add', product: coke });
    state = cartReducer(state, { type: 'add', product: coke });
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].quantity).toBe('2');
  });

  it('removes a line when decremented to zero', () => {
    let state = cartReducer(emptyCart, { type: 'add', product: coke });
    state = cartReducer(state, { type: 'increment', key: state.lines[0].key, by: -1 });
    expect(state.lines).toHaveLength(0);
  });

  it('adds decimal quantities without float drift', () => {
    let state = cartReducer(emptyCart, { type: 'add', product: rice, quantity: '0.1' });
    state = cartReducer(state, { type: 'add', product: rice, quantity: '0.2' });
    expect(state.lines[0].quantity).toBe('0.3');
  });

  it('clears manual discounts when an SC/PWD discount is chosen', () => {
    let state = cartReducer(emptyCart, { type: 'add', product: coke });
    state = cartReducer(state, { type: 'setLineDiscount', key: state.lines[0].key, discount: { type: 'percent', value: '10' } });
    state = cartReducer(state, { type: 'setSaleDiscount', discount: { type: 'senior_citizen', idNumber: 'SC-1', holderName: 'Lola' } });
    expect(state.lines[0].discount).toBeUndefined();
  });
});

describe('isValidQuantity', () => {
  it('enforces whole units unless the product allows decimals', () => {
    expect(isValidQuantity({ key: 'a', product: coke, quantity: '1.5' })).toBe(false);
    expect(isValidQuantity({ key: 'a', product: coke, quantity: '2' })).toBe(true);
    expect(isValidQuantity({ key: 'b', product: rice, quantity: '1.250' })).toBe(true);
    expect(isValidQuantity({ key: 'b', product: rice, quantity: '0' })).toBe(false);
  });
});

describe('cartPayload', () => {
  it('sends only ids, quantities and discount requests — never prices', () => {
    let state = cartReducer(emptyCart, { type: 'add', product: coke });
    state = cartReducer(state, { type: 'setSaleDiscount', discount: { type: 'pwd', idNumber: 'PWD-9', holderName: 'Ana' } });
    const payload = cartPayload(state, 7);
    expect(payload).toEqual({
      register_id: 7,
      items: [{ product_id: 1, quantity: '1' }],
      discount: { type: 'pwd', id_number: 'PWD-9', holder_name: 'Ana' },
    });
    expect(JSON.stringify(payload)).not.toContain('price');
  });
});
