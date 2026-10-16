import {
  Banknote,
  Building2,
  CalendarDays,
  CreditCard,
  Download,
  Landmark,
  MoreHorizontal,
  PieChart,
  Plus,
  ReceiptText,
  Smartphone,
  Trash2,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button, DateRange, EmptyState, ErrorBanner, Field, FormSection, IconButton, Input, LoadingRows, Modal, PageHeader, Pagination, Segmented, Select, StatCard, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { firstOfMonthManila, formatMoney, titleCase, todayManila } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Expense, Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

interface ExpenseCategory {
  id: number;
  name: string;
  is_active: boolean;
}

const METHODS: Record<string, { label: string; icon: LucideIcon }> = {
  cash: { label: 'Cash', icon: Banknote },
  bank_transfer: { label: 'Bank transfer', icon: Landmark },
  gcash: { label: 'GCash', icon: Smartphone },
  maya: { label: 'Maya', icon: Smartphone },
  card: { label: 'Card', icon: CreditCard },
  other: { label: 'Other', icon: MoreHorizontal },
};

const CHIP_COLORS = ['bg-brand-50 text-brand-700 ring-brand-200', 'bg-sky-50 text-sky-700 ring-sky-200', 'bg-amber-50 text-amber-800 ring-amber-200', 'bg-violet-50 text-violet-700 ring-violet-200', 'bg-rose-50 text-rose-700 ring-rose-200', 'bg-teal-50 text-teal-700 ring-teal-200'];
const BAR_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-teal-500'];

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function presets() {
  const today = todayManila();
  const monthStart = firstOfMonthManila();
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'last', label: 'Last month', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    { key: '30', label: '30 days', from: addDays(today, -29), to: today },
    { key: 'year', label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

const dayParts = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return { day: d.getDate(), month: d.toLocaleDateString('en-PH', { month: 'short' }), weekday: d.toLocaleDateString('en-PH', { weekday: 'short' }) };
};

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

  const ranges = presets();
  const active = ranges.find((r) => r.from === from && r.to === to)?.key ?? 'custom';
  const setRange = (r: { from: string; to: string }) => { setFrom(r.from); setTo(r.to); setPage(1); };

  const rows = list.data?.data ?? [];
  const total = list.data?.meta?.total ?? list.data?.total ?? rows.length;
  const partial = total > rows.length;
  const spent = rows.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = Object.entries(rows.reduce<Record<string, number>>((acc, e) => {
    const k = e.category?.name ?? 'Uncategorised';
    acc[k] = (acc[k] ?? 0) + Number(e.amount);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const catIndex = (name: string | undefined) => {
    const all = categories.data?.data ?? [];
    const i = all.findIndex((c) => c.name === name);
    return (i < 0 ? 0 : i) % CHIP_COLORS.length;
  };
  const ready = list.data !== undefined;
  const scope = partial ? 'This page only' : 'In selected period';

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Expenses"
        description="Operating costs such as rent, utilities and supplies. They feed the operating-profit report."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} disabled={rows.length === 0}
              onClick={() => downloadCsv(`expenses-${from}-to-${to}.csv`, ['Date', 'Category', 'Description', 'Branch', 'Paid via', 'Reference', 'Amount'],
                rows.map((e) => [e.expense_date.slice(0, 10), e.category?.name ?? '', e.description, branchName(e.branch_id), e.payment_method ? METHODS[e.payment_method]?.label ?? titleCase(e.payment_method) : '', e.reference ?? '', e.amount]))}>
              Export CSV
            </Button>
            {can('expenses.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Record expense</Button>}
          </>
        }
      />

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="featured" icon={Wallet} label="Total spent" value={ready ? formatMoney(spent.toFixed(2)) : null} hint={scope} />
        <StatCard tone="brand" icon={ReceiptText} label="Entries" value={ready ? total : null} hint={rows.length ? `Avg ${formatMoney((spent / rows.length).toFixed(2))} each` : 'Nothing recorded'} />
        <StatCard tone="sun" icon={PieChart} label="Top category" value={ready ? byCategory[0]?.[0] ?? '—' : null} hint={byCategory[0] ? `${formatMoney(byCategory[0][1].toFixed(2))} · ${((byCategory[0][1] / spent) * 100).toFixed(0)}% of spend` : 'No spending yet'} />
        <StatCard tone="rose" icon={TrendingDown} label="Largest expense" value={ready ? (rows.length ? formatMoney(Math.max(...rows.map((e) => Number(e.amount))).toFixed(2)) : '—') : null}
          hint={rows.length ? rows.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a)).description : '—'} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <section className="min-w-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
            <Segmented label="Period" value={active} onChange={(k) => { const r = ranges.find((x) => x.key === k); if (r) setRange(r); }}
              options={[...ranges.map((r) => ({ value: r.key, label: r.label })), ...(active === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]} />
            <DateRange className="lg:ml-auto" from={from} to={to} onChange={setRange} />
          </div>

          {list.error ? (
            <ErrorBanner error={list.error} className="m-4" />
          ) : !ready ? (
            <LoadingRows label="Loading expenses" />
          ) : rows.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No expenses in this period" description="Try another period, or record rent, utilities and supplies as you pay them."
              action={can('expenses.manage') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Record expense</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400">
                    <th scope="col" className="py-3 pl-5 pr-3 text-left font-semibold">Expense</th>
                    <th scope="col" className="px-3 py-3 text-left font-semibold">Category</th>
                    <th scope="col" className="px-3 py-3 text-left font-semibold">Branch</th>
                    <th scope="col" className="px-3 py-3 text-left font-semibold">Paid via</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Amount</th>
                    <th scope="col" className="w-12 pr-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((e) => {
                    const d = dayParts(e.expense_date);
                    const method = e.payment_method ? METHODS[e.payment_method] : undefined;
                    const MethodIcon = method?.icon ?? MoreHorizontal;
                    return (
                      <tr key={e.id} className="group transition-colors hover:bg-brand-50/40">
                        <td className="py-3 pl-5 pr-3">
                          <span className="flex items-center gap-3">
                            <span className="flex w-11 shrink-0 flex-col items-center overflow-hidden rounded-lg bg-white text-center ring-1 ring-slate-200">
                              <span className="w-full bg-brand-700 py-px text-[9px] font-bold uppercase tracking-wider text-white">{d.month}</span>
                              <span className="font-display text-base font-bold leading-6 text-slate-900">{d.day}</span>
                            </span>
                            <span className="min-w-0">
                              <span className="block max-w-xs truncate font-medium text-slate-900">{e.description}</span>
                              <span className="block text-xs text-slate-400">{d.weekday}{e.reference && <> · <span className="font-mono">{e.reference}</span></>}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {e.category ? <span className={cx('whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', CHIP_COLORS[catIndex(e.category.name)])}>{e.category.name}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-600"><Building2 className="size-3.5 text-slate-400" />{branchName(e.branch_id)}</span>
                        </td>
                        <td className="px-3 py-3">
                          {e.payment_method ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-600"><MethodIcon className="size-3.5 text-slate-400" />{method?.label ?? titleCase(e.payment_method)}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-display font-semibold tabular-nums text-slate-900">{formatMoney(e.amount)}</td>
                        <td className="pr-4 text-right">
                          {can('expenses.manage') && (
                            <span className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                              <IconButton label="Delete expense" icon={Trash2} tone="danger" onClick={() => confirm('Delete this expense? It stays in the audit log.') && remove.mutate(e.id)} />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} data={list.data} onPage={setPage} />
        </section>

        <aside className="h-fit rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100"><PieChart className="size-4" /></span>
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">Where it went</h2>
              <p className="text-xs text-slate-500">{scope}</p>
            </div>
          </div>
          {!ready ? (
            <div className="mt-5 space-y-4">{[0, 1, 2].map((i) => <span key={i} className="block h-8 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : byCategory.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-400">No spending to break down.</p>
          ) : (
            <>
              <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                {byCategory.map(([name, amt]) => <span key={name} className={cx('h-full', BAR_COLORS[catIndex(name)])} style={{ width: `${(amt / spent) * 100}%` }} title={name} />)}
              </div>
              <ul className="mt-5 space-y-3">
                {byCategory.map(([name, amt]) => (
                  <li key={name} className="flex items-center gap-2.5 text-sm">
                    <span className={cx('size-2.5 shrink-0 rounded-full', BAR_COLORS[catIndex(name)])} />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{name}</span>
                    <span className="text-xs tabular-nums text-slate-400">{((amt / spent) * 100).toFixed(0)}%</span>
                    <span className="w-24 text-right font-medium tabular-nums text-slate-900">{formatMoney(amt.toFixed(2))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <ExpenseForm open={adding} onClose={() => setAdding(false)} categories={(categories.data?.data ?? []).filter((c) => c.is_active)} />
    </>
  );
}

function ExpenseForm({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: ExpenseCategory[] }) {
  const { branches, branch, allBranches } = useTenant();
  const blank = () => ({ expense_category_id: '', amount: '', expense_date: todayManila(), description: '', branch_id: String(branch?.id ?? ''), payment_method: 'cash', reference: '' });
  const [form, setForm] = useState(blank);
  const close = () => { setForm(blank()); onClose(); };
  const save = useTenantMutation<Record<string, unknown>>('POST', '/expenses', { success: 'Expense recorded.', onSuccess: close, toastErrors: false });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const set = (k: keyof ReturnType<typeof blank>) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const amount = Number(form.amount);
  const valid = amount > 0 && form.expense_category_id !== '' && form.description.trim() !== '';
  const category = categories.find((c) => String(c.id) === form.expense_category_id)?.name;

  return (
    <Modal open={open} onClose={close} title="Record expense" icon={ReceiptText} size="lg" description="Logged against the branch and date you choose."
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate({ ...form, expense_category_id: Number(form.expense_category_id) || null, branch_id: form.branch_id ? Number(form.branch_id) : null, reference: form.reference || null })}>Save expense</Button></>}>
      <div className="space-y-6">
        {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} />}

        {/* Amount hero */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white shadow-md shadow-brand-900/20">
          <label htmlFor="expense-amount" className="text-[11px] font-semibold uppercase tracking-wider text-brand-100">Amount</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-display text-3xl font-bold text-sun-300">₱</span>
            <input id="expense-amount" inputMode="decimal" autoFocus placeholder="0.00" value={form.amount}
              onChange={(e) => set('amount')(e.target.value.replace(/[^\d.]/g, ''))}
              className="w-full bg-transparent font-display text-3xl font-bold tabular-nums text-white outline-none placeholder:text-white/30" />
          </div>
          {err('amount') && <p className="mt-1 text-xs text-rose-200">{err('amount')}</p>}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-100/80">
            <CalendarDays className="size-3.5" />
            {form.expense_date || '—'}{category && <> · {category}</>}
          </p>
        </div>

        <FormSection title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" error={err('expense_category_id')}>{(id) => <Select id={id} value={form.expense_category_id} onChange={(e) => set('expense_category_id')(e.target.value)}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            <Field label="Date" error={err('expense_date')}>{(id) => <Input id={id} type="date" max={todayManila()} value={form.expense_date} onChange={(e) => set('expense_date')(e.target.value)} />}</Field>
            <Field label="Description" error={err('description')} className="sm:col-span-2">{(id) => <Input id={id} placeholder="e.g. Electricity bill — October" value={form.description} onChange={(e) => set('description')(e.target.value)} />}</Field>
            <Field label="Branch">{(id) => <Select id={id} value={form.branch_id} onChange={(e) => set('branch_id')(e.target.value)}>{allBranches && <option value="">Business-wide</option>}{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
            <Field label="Reference / OR no." hint="Optional">{(id) => <Input id={id} value={form.reference} onChange={(e) => set('reference')(e.target.value)} />}</Field>
          </div>
        </FormSection>

        <FormSection title="Paid via">
          <div role="radiogroup" aria-label="Paid via" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Object.entries(METHODS).map(([value, m]) => {
              const on = form.payment_method === value;
              return (
                <button key={value} type="button" role="radio" aria-checked={on} onClick={() => set('payment_method')(value)}
                  className={cx('flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-medium ring-1 transition',
                    on ? 'bg-brand-50 text-brand-800 ring-2 ring-brand-500' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300')}>
                  <m.icon className={cx('size-5', on ? 'text-brand-600' : 'text-slate-400')} />
                  {m.label}
                </button>
              );
            })}
          </div>
        </FormSection>
      </div>
    </Modal>
  );
}
