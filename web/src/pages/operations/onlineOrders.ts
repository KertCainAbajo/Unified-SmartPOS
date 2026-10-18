/** Shared shapes and formatting for the staff online-order screens. */

export type OrderStatus = 'pending' | 'confirmed' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
export type OrderView = 'active' | 'completed' | 'cancelled';
export type OrderKind = 'all' | 'pickup' | 'delivery';

export interface OnlineOrder {
  id: number;
  order_number: string;
  status: OrderStatus;
  fulfilment: 'pickup' | 'delivery';
  delivery_address: string | null;
  cash_amount: string | null;
  change_due: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  rider_user_id?: number | null;
  rider_lat?: number | null;
  rider_lng?: number | null;
  rider_location_at?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  delivered_at?: string | null;
  delivery_issue?: string | null;
  contact_name: string;
  contact_phone: string;
  note: string | null;
  estimated_total: string;
  placed_at: string;
  confirmed_at?: string | null;
  ready_at?: string | null;
  dispatched_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: 'customer' | 'staff' | null;
  cancel_reason?: string | null;
  sale_id?: number | null;
  branch: { id: number; name: string; address?: string | null; latitude?: number | null; longitude?: number | null };
  account: { name: string; email: string; phone: string };
  items: { id: number; name: string; sku: string; unit: string; quantity: string; line_total: string }[];
}

export const money = (v: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(v));
export const qty = (v: string) => String(Number(v));

/** A date in Manila, `days` days before today, as YYYY-MM-DD. */
export function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
