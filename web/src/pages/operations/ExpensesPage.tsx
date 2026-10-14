import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { firstOfMonthManila, formatDate, formatMoney, titleCase, todayManila } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Expense, Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

interface ExpenseCategory {
  id: number;
  name: string;
  is_active: boolean;
}

export function ExpensesPage() {
  const { can, branches } = useTenant();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(firstOfMonthManila());
  const [to, setTo] = useState(todayManila());
  const [adding, setAdding] = useState(false);
  const list = useTenantQuery<Paginated<Expense>>('/expenses', { date_from: from, date_to: to, page });
  const categories = useTenantQuery<{ data: ExpenseCategory[] }>('/expense-categories');
  const remove = useTenantMutation<number>('DELETE', (id) => `/expenses/${id}`, { success: 'Expense deleted.' });
  const branchName = (id: number | null) => (id === null ? 'Business-wide' : branches.find((b) => b.id === id)?.name ?? `#${id}`);

  if (!can('expenses.view')) return <NoAccess what="expenses" />;

  return (
    <>
      <PageHeader title="Expenses" description="Operating expenses used in the operating-profit report." actions={can('expenses.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Record expense</Button>} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input className="w-auto" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From" />
          <Input className="w-auto" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To" />
        </div>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(e) => e.id}
          empty="No expenses in this period."
          columns={[
            { header: 'Date', cell: (e) => formatDate(e.expense_date) },
            { header: 'Category', cell: (e) => e.category?.name ?? '—' },
            { header: 'Description', cell: (e) => e.description },
            { header: 'Branch', cell: (e) => branchName(e.branch_id) },
            { header: 'Paid via', cell: (e) => (e.payment_method ? titleCase(e.payment_method) : '—') },
            { header: 'Amount', cell: (e) => formatMoney(e.amount), align: 'right' },
            { header: '', cell: (e) => can('expenses.manage') && <Button size="sm" variant="ghost" onClick={() => confirm('Delete this expense? It stays in the audit log.') && remove.mutate(e.id)}>Delete</Button> },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>
      <ExpenseForm open={adding} onClose={() => setAdding(false)} categories={(categories.data?.data ?? []).filter((c) => c.is_active)} />
    </>
  );
}

function ExpenseForm({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: ExpenseCategory[] }) {
  const { branches, branch, allBranches } = useTenant();
  const [form, setForm] = useState({ expense_category_id: '', amount: '', expense_date: todayManila(), description: '', branch_id: String(branch?.id ?? ''), payment_method: 'cash', reference: '' });
  const save = useTenantMutation<Record<string, unknown>>('POST', '/expenses', { success: 'Expense recorded.', onSuccess: onClose, toastErrors: false });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title="Record expense"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate({ ...form, expense_category_id: Number(form.expense_category_id) || null, branch_id: form.branch_id ? Number(form.branch_id) : null, reference: form.reference || null })}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} className="sm:col-span-2" />}
        <Field label="Category" error={err('expense_category_id')}>{(id) => <Select id={id} value={form.expense_category_id} onChange={(e) => set('expense_category_id')(e.target.value)}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Amount (₱)" error={err('amount')}>{(id) => <Input id={id} inputMode="decimal" value={form.amount} onChange={(e) => set('amount')(e.target.value)} />}</Field>
        <Field label="Date" error={err('expense_date')}>{(id) => <Input id={id} type="date" value={form.expense_date} onChange={(e) => set('expense_date')(e.target.value)} />}</Field>
        <Field label="Branch">{(id) => <Select id={id} value={form.branch_id} onChange={(e) => set('branch_id')(e.target.value)}>{allBranches && <option value="">Business-wide</option>}{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
        <Field label="Description" error={err('description')} className="sm:col-span-2">{(id) => <Input id={id} value={form.description} onChange={(e) => set('description')(e.target.value)} />}</Field>
        <Field label="Paid via">{(id) => <Select id={id} value={form.payment_method} onChange={(e) => set('payment_method')(e.target.value)}>{['cash', 'bank_transfer', 'gcash', 'maya', 'card', 'other'].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select>}</Field>
        <Field label="Reference / OR no.">{(id) => <Input id={id} value={form.reference} onChange={(e) => set('reference')(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
