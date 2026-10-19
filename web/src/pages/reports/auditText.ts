import { formatDateTime, formatMoney, titleCase } from '../../lib/format';
import type { AuditLogEntry } from '../../lib/types';

/** Plain-language titles for audit actions. Anything missing falls back to a readable version of the code. */
const ACTIONS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.logout': 'Signed out',
  'auth.logout_all': 'Signed out of all devices',
  'auth.password_reset': 'Reset their password',
  'branch.created': 'Added a branch',
  'branch.updated': 'Changed branch details',
  'category.created': 'Added a product category',
  'category.updated': 'Changed a product category',
  'category.deleted': 'Deleted a product category',
  'customer.created': 'Added a customer',
  'customer.updated': 'Changed customer details',
  'expense.recorded': 'Recorded an expense',
  'expense.updated': 'Changed an expense',
  'expense.deleted': 'Deleted an expense',
  'expense_category.created': 'Added an expense category',
  'expense_category.updated': 'Changed an expense category',
  'goods_receipt.posted': 'Received stock from a supplier',
  'inventory.adjusted': 'Adjusted stock',
  'online_order.status_changed': 'Updated an online order',
  'online_order.claimed_by_rider': 'Rider took a delivery',
  'online_order.delivered': 'Rider delivered an order',
  'online_order.returned_to_store': 'Rider brought an order back',
  'platform.tenant_status_changed': 'Changed the business status',
  'product.created': 'Added a product',
  'product.updated': 'Changed product details',
  'product.price_changed': 'Changed a product price',
  'product.archived': 'Archived a product',
  'product.restored': 'Restored a product',
  'product.image_updated': 'Changed a product photo',
  'product.image_removed': 'Removed a product photo',
  'purchase_order.created': 'Created a purchase order',
  'purchase_order.updated': 'Changed a purchase order',
  'purchase_order.ordered': 'Sent a purchase order to the supplier',
  'purchase_order.closed': 'Closed a purchase order',
  'purchase_order.cancelled': 'Cancelled a purchase order',
  'recruitment.vacancy_created': 'Opened a job vacancy',
  'recruitment.vacancy_updated': 'Changed a job vacancy',
  'recruitment.vacancy_filled': 'Filled a job vacancy',
  'recruitment.unauthorized_attempt': 'Tried a recruitment action without permission',
  'refund.requested': 'Requested a refund',
  'refund.completed': 'Completed a refund',
  'refund.rejected': 'Rejected a refund',
  'register.created': 'Added a register',
  'register.updated': 'Changed a register',
  'rider.on_duty': 'Rider went on duty',
  'rider.off_duty': 'Rider went off duty',
  'role.created': 'Created a role',
  'role.updated': 'Changed a role',
  'role.deleted': 'Deleted a role',
  'sale.completed': 'Completed a sale',
  'sale.voided': 'Voided a sale',
  'shift.opened': 'Opened a shift',
  'shift.closed': 'Closed a shift',
  'staff.created': 'Added a staff member',
  'staff.activated': 'Staff member activated their account',
  'staff.activation_failed': 'Failed account activation attempt',
  'staff.branches_changed': 'Changed which branches a staff member works at',
  'staff.code_locked': 'Locked a staff code after too many attempts',
  'staff.existing_account_invited': 'Invited an existing account to join',
  'staff.invitation_issued': 'Sent a staff invitation',
  'staff.invitation_accepted': 'Accepted a staff invitation',
  'staff.invitation_declined': 'Declined a staff invitation',
  'staff.invitation_expired': 'A staff invitation expired',
  'staff.invite_existing_skipped': 'Skipped inviting an existing account',
  'staff.offboarded': 'Removed a staff member',
  'staff.profile_updated': 'Changed staff details',
  'staff.reactivated': 'Reactivated a staff member',
  'staff.recovery_issued': 'Issued an account recovery code',
  'staff.recovery_requested': 'Requested account recovery',
  'staff.recovery_completed': 'Recovered their account',
  'staff.rehired': 'Rehired a staff member',
  'staff.roles_changed': 'Changed a staff member’s role',
  'staff.suspended': 'Suspended a staff member',
  'staff.temporary_password_issued': 'Issued a temporary password',
  'staff.unauthorized_attempt': 'Tried a staff action without permission',
  'stock_count.created': 'Started a stock count',
  'stock_count.completed': 'Finished a stock count',
  'stock_count.cancelled': 'Cancelled a stock count',
  'stock_transfer.created': 'Created a stock transfer',
  'stock_transfer.dispatched': 'Sent a stock transfer',
  'stock_transfer.received': 'Received a stock transfer',
  'stock_transfer.cancelled': 'Cancelled a stock transfer',
  'supplier.created': 'Added a supplier',
  'supplier.updated': 'Changed supplier details',
  'tenant.created': 'Created the business',
  'tenant.settings_updated': 'Changed business settings',
  'user.password_changed': 'Changed their password',
  'user.profile_updated': 'Changed their profile',
};

/** Friendly names for record types (the model class name). */
const RECORDS: Record<string, string> = {
  GoodsReceipt: 'Stock receipt', PurchaseOrder: 'Purchase order', StockTransfer: 'Stock transfer', StockCount: 'Stock count',
  InventoryMovement: 'Stock movement', Inventory: 'Stock record', RegisterSession: 'Shift', TenantMembership: 'Staff member',
  OnlineOrder: 'Online order', ExpenseCategory: 'Expense category', Tenant: 'Business', User: 'User account',
};

/** Friendlier labels for field names where Title Case is not clear enough. */
const FIELDS: Record<string, string> = {
  items: 'Number of items', reference: 'Reference no.', total_cost: 'Total cost', purchase_order_id: 'Purchase order',
  cost_price: 'Cost', price: 'Selling price', sku: 'SKU', tin: 'TIN', vat_rate: 'VAT rate', vat_registered: 'VAT-registered',
  is_active: 'Active', track_inventory: 'Track stock', reorder_level: 'Low-stock alert at', quantity_change: 'Quantity change',
  opening_float: 'Opening cash', counted_cash: 'Cash counted', expected_cash: 'Cash expected', cash_difference: 'Cash over/short',
  all_branches: 'All branches', branch_ids: 'Branches', role_keys: 'Roles', on_duty: 'On duty', category_id: 'Category',
  supplier_id: 'Supplier', branch_id: 'Branch', register_id: 'Register', user_id: 'Staff member', order_number: 'Order no.',
  rider_name: 'Rider', cancel_reason: 'Reason for cancelling', image_path: 'Photo', ip: 'IP address',
};

const MONEY = /(^|_)(price|cost|total|amount|float|cash|subtotal|discount|threshold|value|change_due|paid)(_|$)/;

export const actionTitle = (action: string) => ACTIONS[action] ?? titleCase(action.replace(/\./g, ' ').replace(/_/g, ' '));

export const recordName = (type: string | null) => {
  const base = type?.split('\\').pop() ?? '';
  return RECORDS[base] ?? titleCase(base.replace(/([a-z])([A-Z])/g, '$1 $2'));
};

export const fieldLabel = (key: string) => FIELDS[key] ?? titleCase(key.replace(/_id$/, '').replace(/_/g, ' '));

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** A value as a person would read it: money with ₱, Yes/No, dates, lists, readable statuses. */
export function formatValue(key: string, v: unknown, branchName?: (id: number) => string, people?: Record<string, string>): string {
  if (isEmpty(v)) return 'None';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if ((key.endsWith('user_id') || key.endsWith('_by')) && people?.[String(v)]) return people[String(v)];
  if (key === 'branch_id' && typeof v === 'number' && branchName) return branchName(v);
  if (key === 'branch_ids' && Array.isArray(v) && branchName) return v.map((id) => branchName(Number(id))).join(', ');
  if (key === 'image_path') return 'Photo';
  if (key === 'vat_rate' && !Number.isNaN(Number(v))) return `${Number(v)}%`;
  if (MONEY.test(key) && !Number.isNaN(Number(v))) return formatMoney(String(v));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : titleCaseIfCode(String(x)))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return titleCaseIfCode(String(v));
}

/** "out_for_delivery" → "Out for delivery"; ordinary text is left alone. */
const titleCaseIfCode = (s: string) => (/^[a-z]+(_[a-z]+)+$/.test(s) || /^[a-z]+$/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

/** The record's own name when the entry carries one (e.g. GR-000003, Coca-Cola 1L), else "Stock receipt #3". */
export function recordTitle(entry: AuditLogEntry): string | null {
  if (!entry.auditable_type) return null;
  const values = { ...(entry.metadata ?? {}), ...(entry.old_values ?? {}), ...(entry.new_values ?? {}) } as Record<string, unknown>;
  if (entry.subject_name) return `${recordName(entry.auditable_type)} · ${entry.subject_name}`;
  const label = ['reference', 'order_number', 'receipt_number', 'sale_number', 'number', 'name', 'sku'].map((k) => values[k]).find((v) => typeof v === 'string' && v.trim() !== '');
  return `${recordName(entry.auditable_type)} ${label ? `· ${label}` : `#${entry.auditable_id}`}`;
}

/** Split the entry into real before→after changes and plain facts (new records, or values that did not exist before). */
export function splitChanges(entry: AuditLogEntry) {
  const before = entry.old_values ?? {};
  const after = entry.new_values ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  // Lists are compared as sets: [Main, Davao] and [Davao, Main] are the same branches.
  const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
  const changes = keys.filter((k) => !isEmpty(before[k]) && !same(before[k], after[k]));
  const facts = keys.filter((k) => !changes.includes(k) && !isEmpty(after[k]));
  return { changes, facts, before, after };
}
