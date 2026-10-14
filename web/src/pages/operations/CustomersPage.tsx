import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Modal, PageHeader, Pagination, Textarea } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Customer, Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function CustomersPage() {
  const { can } = useTenant();
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const q = useDebounced(term);
  const list = useTenantQuery<Paginated<Customer>>('/customers', { q: q || undefined, page, include_inactive: 1 });

  if (!can('customers.view')) return <NoAccess what="customers" />;

  return (
    <>
      <PageHeader title="Customers" actions={can('customers.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add customer</Button>} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4"><Input className="max-w-sm" placeholder="Search name, phone or email" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} aria-label="Search" /></div>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(c) => c.id}
          onRowClick={can('customers.manage') ? (c) => setEditing(c) : undefined}
          empty="No customers yet."
          columns={[
            { header: 'Name', cell: (c) => <span className="font-medium text-slate-900">{c.name}</span> },
            { header: 'Phone', cell: (c) => c.phone ?? '—' },
            { header: 'Email', cell: (c) => c.email ?? '—' },
            { header: 'TIN', cell: (c) => c.tin ?? '—' },
            { header: 'Status', cell: (c) => <Badge status={c.is_active ? 'active' : 'archived'}>{c.is_active ? 'Active' : 'Inactive'}</Badge> },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>
      <CustomerForm customer={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function CustomerForm({ customer, onClose }: { customer: Customer | 'new' | null; onClose: () => void }) {
  const isNew = customer === 'new';
  const [form, setForm] = useState({ name: '', phone: '', email: '', tin: '', address: '', notes: '', is_active: true });
  useEffect(() => {
    const c = customer && customer !== 'new' ? customer : null;
    setForm({ name: c?.name ?? '', phone: c?.phone ?? '', email: c?.email ?? '', tin: c?.tin ?? '', address: c?.address ?? '', notes: c?.notes ?? '', is_active: c?.is_active ?? true });
  }, [customer]);
  const save = useTenantMutation<Record<string, unknown>>(isNew ? 'POST' : 'PATCH', isNew ? '/customers' : `/customers/${(customer as Customer | null)?.id}`, { success: 'Customer saved.', onSuccess: onClose, toastErrors: false });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const body = () => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));

  return (
    <Modal open={customer !== null} onClose={onClose} title={isNew ? 'Add customer' : 'Edit customer'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(body())}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={err('name')} className="sm:col-span-2">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
        <Field label="Phone" error={err('phone')}>{(id) => <Input id={id} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />}</Field>
        <Field label="Email" error={err('email')}>{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />}</Field>
        <Field label="TIN" error={err('tin')}>{(id) => <Input id={id} value={form.tin} onChange={(e) => setForm((f) => ({ ...f, tin: e.target.value }))} />}</Field>
        <Field label="Address" error={err('address')}>{(id) => <Input id={id} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(id) => <Textarea id={id} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />}</Field>
        {!isNew && <Checkbox label="Active" checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />}
      </div>
    </Modal>
  );
}
