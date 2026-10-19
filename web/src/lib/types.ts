/** Shapes returned by the Laravel API (see docs/openapi.json). Money/quantities are decimal strings. */

export interface Paginated<T> {
  data: T[];
  meta?: { current_page: number; last_page: number; per_page: number; total: number };
  current_page?: number;
  last_page?: number;
  total?: number;
}

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  email_verified: boolean;
  username?: string | null;
  must_change_password?: boolean;
  is_platform_admin?: boolean;
}

export interface Branch {
  id: number;
  code: string;
  name: string;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone: string | null;
  is_active: boolean;
}

export interface Role {
  id: number;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  /** Holders sign in with email (owners, managers, HR) instead of username / employee ID. */
  requires_email_sign_in: boolean;
  /** Whether the signed-in user may give this role (administrative roles are owner-only). */
  assignable?: boolean | null;
  permissions?: string[];
}

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  legal_name: string | null;
  tin: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  staff_email_domain: string | null;
  recruitment_allow_self_approval: boolean;
  currency: string;
  timezone: string;
  vat_registered: boolean;
  vat_rate: string;
  prices_include_vat: boolean;
  allow_negative_stock: boolean;
  refund_approval_threshold: string;
  refund_window_days: number;
  status: string;
  owner_user_id: number;
}

export interface Membership {
  id: number;
  tenant_id: number;
  status: string;
  all_branches: boolean;
  tenant?: { id: number; name: string; slug: string; status: string };
  user?: User;
  roles?: Role[];
  branches?: Branch[];
}

/** A staff member as returned by /tenants/{id}/staff (see docs/STAFF_ACCOUNTS.md). */
export interface StaffMember {
  id: number;
  user_id: number;
  account_type: 'company_managed' | 'personal';
  name: string | null;
  username: string | null;
  email: string | null;
  sign_in_with: 'username' | 'email';
  employee_code: string | null;
  status: 'invited' | 'active' | 'suspended' | 'offboarded';
  user_status: string | null;
  status_reason: string | null;
  all_branches: boolean;
  branches?: Branch[];
  roles?: Role[];
  pending_code: { purpose: string; channel: string; expires_at: string; expired: boolean } | null;
  last_login_at: string | null;
  must_change_password: boolean | null;
  profile?: StaffProfile | null;
}

export interface StaffProfile {
  job_title: string | null;
  hire_date: string | null;
  phone: string | null;
  address: string | null;
  birth_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
}

export interface TenantContextData {
  tenant: Tenant;
  membership_id: number;
  roles: string[];
  permissions: string[];
  all_branches: boolean;
  branches: Branch[];
}

export type TaxType = 'vatable' | 'vat_exempt' | 'zero_rated';

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  products_count?: number;
}

export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  category_id: number | null;
  category?: { id: number; name: string } | null;
  unit: string;
  price: string;
  cost_price?: string;
  tax_type: TaxType;
  track_inventory: boolean;
  allow_decimal_quantity: boolean;
  reorder_level: string;
  status: 'active' | 'archived';
  stock?: { branch_id: number; quantity: string }[];
}

export interface InventoryRow {
  branch_id: number;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  reorder_level: string;
}

export interface StockMovement {
  id: number;
  branch_id: number;
  product_id: number;
  product?: { id: number; sku: string; name: string; unit: string };
  type: string;
  quantity_change: string;
  quantity_before: string;
  quantity_after: string;
  unit_cost: string | null;
  reason: string | null;
  user?: { id: number; name: string } | null;
  created_at: string;
}

export interface Register {
  id: number;
  branch_id: number;
  code: string;
  name: string;
  is_active: boolean;
  open_session: { id: number; opened_by: number; opened_at: string } | null;
}

export interface ShiftSummary {
  sales_count: number;
  voided_count: number;
  gross_sales: string;
  discounts: string;
  vat_amount: string;
  refunds: string;
  payments_by_method: { method: string; count: number; amount: string }[];
  cash: {
    opening_float: string;
    cash_sales: string;
    cash_refunds: string;
    expected_cash: string;
    counted_cash: string | null;
    cash_difference: string | null;
  };
}

export interface RegisterSession {
  id: number;
  branch_id: number;
  register_id: number;
  status: 'open' | 'closed';
  opened_by: number;
  closed_by: number | null;
  opening_float: string;
  cash_sales: string;
  cash_refunds: string;
  expected_cash: string | null;
  counted_cash: string | null;
  cash_difference: string | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  summary?: ShiftSummary;
}

export type PaymentMethod = 'cash' | 'card' | 'gcash' | 'maya' | 'bank_transfer' | 'other';

export interface SaleItem {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  tax_type: TaxType;
  quantity: string;
  unit_price: string;
  gross_amount: string;
  discount_type: string;
  discount_value: string;
  discount_amount: string;
  vat_exemption_amount: string;
  vat_amount: string;
  line_total: string;
  quantity_refunded: string;
}

export interface Payment {
  id: number;
  method: PaymentMethod;
  amount: string;
  tendered: string;
  reference_number: string | null;
  status: string;
}

export type SaleChannel = 'in_store' | 'pickup' | 'delivery';

export interface Sale {
  /** Where the sale came from: a counter sale or a completed online pickup/delivery order. */
  channel?: SaleChannel;
  online_order?: { id: number; order_number: string; fulfilment: 'pickup' | 'delivery'; rider_name: string | null; delivery_address: string | null };
  id: number;
  receipt_number: string;
  status: 'completed' | 'voided';
  payment_status: 'paid' | 'partially_refunded' | 'refunded' | 'voided';
  branch_id: number;
  register_id: number;
  register_session_id: number;
  cashier?: { id: number; name: string };
  cashier_id: number;
  customer?: { id: number; name: string; tin: string | null } | null;
  subtotal: string;
  discount_total: string;
  vat_exemption_amount: string;
  vatable_sales: string;
  vat_exempt_sales: string;
  zero_rated_sales: string;
  vat_amount: string;
  total: string;
  amount_tendered: string;
  change_due: string;
  refunded_total: string;
  discount: { type: 'none' | 'senior_citizen' | 'pwd'; id_number: string | null; holder_name: string | null };
  notes: string | null;
  business_date: string;
  sold_at: string;
  voided_at: string | null;
  void_reason: string | null;
  items?: SaleItem[];
  payments?: Payment[];
}

export interface Receipt {
  header: { business_name: string; legal_name: string | null; tin: string | null; vat_status: string; branch: string; address: string | null; phone: string | null };
  receipt_number: string;
  status: string;
  reprint: boolean;
  date: string;
  cashier: string | null;
  customer: { name: string; tin: string | null; address: string | null } | null;
  lines: { name: string; sku: string; quantity: string; unit_price: string; discount: string; amount: string; tax_code: string }[];
  totals: {
    subtotal: string;
    less_vat_sc_pwd: string;
    discount: string;
    total: string;
    vatable_sales: string;
    vat_amount: string;
    vat_exempt_sales: string;
    zero_rated_sales: string;
  };
  statutory_discount: { type: string; id_number: string; holder_name: string } | null;
  payments: { method: PaymentMethod; tendered: string; reference_number: string | null }[];
  amount_tendered: string;
  change: string;
  footer: string | null;
}

export interface QuoteLine {
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  gross_amount: string;
  discount_amount: string;
  vat_exemption_amount: string;
  vat_amount: string;
  line_total: string;
  available_stock: string | null;
  in_stock: boolean;
}

export interface QuoteTotals {
  subtotal: string;
  discount_total: string;
  vat_exemption_amount: string;
  vatable_sales: string;
  vat_exempt_sales: string;
  zero_rated_sales: string;
  vat_amount: string;
  total: string;
}

export interface Refund {
  id: number;
  reference: string;
  sale_id: number;
  branch_id: number;
  status: 'pending_approval' | 'completed' | 'rejected';
  reason: string;
  refund_method: PaymentMethod;
  subtotal: string;
  vat_amount: string;
  total: string;
  requested_by: number;
  approved_by: number | null;
  rejection_reason: string | null;
  created_at: string;
  items: { id: number; sale_item_id: number; product_id: number; quantity: string; amount: string; restock: boolean }[] | null;
}

export interface Customer {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  tin: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  tin: string | null;
  is_active: boolean;
}

export interface PurchaseOrder {
  id: number;
  reference: string;
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'closed' | 'cancelled';
  branch_id: number;
  supplier: { id: number; name: string } | null;
  supplier_id: number;
  order_date: string;
  expected_date: string | null;
  total: string;
  notes: string | null;
  items:
    | { id: number; product_id: number; product: { id: number; sku: string; name: string; unit: string } | null; quantity_ordered: string; quantity_received: string; unit_cost: string; line_total: string }[]
    | null;
  created_at: string;
}

export interface StockTransfer {
  id: number;
  reference: string;
  from_branch_id: number;
  to_branch_id: number;
  status: 'draft' | 'in_transit' | 'received' | 'cancelled';
  notes: string | null;
  items?: { id: number; product_id: number; product: { id: number; sku: string; name: string; unit: string } | null; quantity: string; quantity_received: string }[];
  created_at: string;
}

export interface Expense {
  id: number;
  branch_id: number | null;
  expense_category_id: number;
  category: { id: number; name: string } | null;
  amount: string;
  expense_date: string;
  description: string;
  reference: string | null;
  payment_method: PaymentMethod | null;
  created_at: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  user: { id: number; name: string } | null;
  branch_id: number | null;
  auditable_type: string | null;
  auditable_id: number | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface ReportResponse<T> {
  filters: { date_from: string; date_to: string; branch_ids: number[] | null; timezone: string; currency: string };
  data: T;
}
