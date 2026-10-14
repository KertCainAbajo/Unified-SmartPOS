import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Select } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Branch, Register } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function SettingsPage() {
  const { can } = useTenant();
  if (!can('tenant.manage') && !can('branches.manage') && !can('registers.manage')) return <NoAccess what="settings" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      {can('tenant.manage') && <BusinessSettings />}
      {can('branches.manage') && <BranchesCard />}
      {can('registers.manage') && <RegistersCard />}
    </div>
  );
}

function BusinessSettings() {
  const { tenant, tenantId } = useTenant();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...tenant });
  useEffect(() => setForm({ ...tenant }), [tenant]);
  const save = useTenantMutation<Record<string, unknown>>('PATCH', '', {
    success: 'Settings saved.',
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tenant-context', tenantId] }),
    toastErrors: false,
  });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const text = (k: 'name' | 'legal_name' | 'tin' | 'address' | 'phone' | 'email', label: string) => (
    <Field label={label} error={err(k)}>{(id) => <Input id={id} value={form[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />}</Field>
  );

  return (
    <Card title="Business">
      {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} className="mb-4" />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {text('name', 'Business name')}
        {text('legal_name', 'Registered name')}
        {text('tin', 'TIN')}
        {text('address', 'Address')}
        {text('phone', 'Phone')}
        {text('email', 'Email')}
        <Field label="Staff email domain" error={err('staff_email_domain')} hint="Used to suggest staff emails, e.g. alingnena.com. Only set a domain whose mailboxes you control.">{(id) => <Input id={id} placeholder="yourcompany.com" value={form.staff_email_domain ?? ''} onChange={(e) => setForm((f) => ({ ...f, staff_email_domain: e.target.value }))} />}</Field>
        <Field label="VAT rate (%)" error={err('vat_rate')}>{(id) => <Input id={id} inputMode="decimal" value={form.vat_rate} onChange={(e) => setForm((f) => ({ ...f, vat_rate: e.target.value }))} />}</Field>
        <Field label="Refunds above this need approval (₱)" error={err('refund_approval_threshold')}>{(id) => <Input id={id} inputMode="decimal" value={form.refund_approval_threshold} onChange={(e) => setForm((f) => ({ ...f, refund_approval_threshold: e.target.value }))} />}</Field>
        <Field label="Refund window (days)" error={err('refund_window_days')} hint="Older sales need approval to refund">{(id) => <Input id={id} inputMode="numeric" value={String(form.refund_window_days)} onChange={(e) => setForm((f) => ({ ...f, refund_window_days: Number(e.target.value) || 0 }))} />}</Field>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Checkbox label="VAT-registered" checked={form.vat_registered} onChange={(v) => setForm((f) => ({ ...f, vat_registered: v }))} />
        <Checkbox label="Prices include VAT" checked={form.prices_include_vat} onChange={(v) => setForm((f) => ({ ...f, prices_include_vat: v }))} />
        <Checkbox label="Allow selling below zero stock (not recommended)" checked={form.allow_negative_stock} onChange={(v) => setForm((f) => ({ ...f, allow_negative_stock: v }))} />
      </div>
      <div className="mt-6 flex justify-end">
        <Button
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              name: form.name, legal_name: form.legal_name || null, staff_email_domain: form.staff_email_domain || null, tin: form.tin || null, address: form.address || null, phone: form.phone || null, email: form.email || null,
              vat_rate: form.vat_rate, vat_registered: form.vat_registered, prices_include_vat: form.prices_include_vat, allow_negative_stock: form.allow_negative_stock,
              refund_approval_threshold: form.refund_approval_threshold, refund_window_days: form.refund_window_days,
            })
          }
        >
          Save settings
        </Button>
      </div>
    </Card>
  );
}

function BranchesCard() {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();
  const list = useTenantQuery<{ data: Branch[] }>('/branches');
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [form, setForm] = useState({ code: '', name: '', address: '', phone: '', is_active: true });
  useEffect(() => {
    const b = editing && editing !== 'new' ? editing : null;
    setForm({ code: b?.code ?? '', name: b?.name ?? '', address: b?.address ?? '', phone: b?.phone ?? '', is_active: b?.is_active ?? true });
  }, [editing]);
  const isNew = editing === 'new';
  const save = useTenantMutation<Record<string, unknown>>(isNew ? 'POST' : 'PATCH', isNew ? '/branches' : `/branches/${(editing as Branch | null)?.id}`, {
    success: 'Branch saved.',
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['tenant-context', tenantId] });
    },
    toastErrors: false,
  });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);

  return (
    <Card title="Branches" padded={false} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add branch</Button>}>
      <DataTable rows={list.data?.data} loading={list.isPending} error={list.error} rowKey={(b) => b.id} onRowClick={setEditing} columns={[
        { header: 'Code', cell: (b) => <code>{b.code}</code> },
        { header: 'Name', cell: (b) => b.name },
        { header: 'Address', cell: (b) => b.address ?? '—' },
        { header: 'Status', cell: (b) => <Badge status={b.is_active ? 'active' : 'archived'}>{b.is_active ? 'Active' : 'Inactive'}</Badge> },
      ]} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={isNew ? 'Add branch' : 'Edit branch'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(isNew ? { code: form.code, name: form.name, address: form.address || null, phone: form.phone || null } : { name: form.name, address: form.address || null, phone: form.phone || null, is_active: form.is_active })}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {isNew && <Field label="Code" error={err('code')} hint="Short code used on receipts, e.g. MKT">{(id) => <Input id={id} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />}</Field>}
          <Field label="Name" error={err('name')}>{(id) => <Input id={id} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
          <Field label="Address">{(id) => <Input id={id} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />}</Field>
          {!isNew && <Checkbox label="Active" checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />}
        </div>
      </Modal>
    </Card>
  );
}

function RegistersCard() {
  const { branches } = useTenant();
  const list = useTenantQuery<{ data: Register[] }>('/registers');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ branch_id: String(branches[0]?.id ?? ''), code: '', name: '' });
  const create = useTenantMutation<Record<string, unknown>>('POST', '/registers', { success: 'Register added.', onSuccess: () => setAdding(false), toastErrors: false });
  const toggle = useTenantMutation<Register>('PATCH', (r) => `/registers/${r.id}`, { success: 'Register updated.' });
  const err = (f: string) => (create.error instanceof ApiError ? create.error.field(f) : undefined);

  return (
    <Card title="Registers" padded={false} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add register</Button>}>
      <DataTable rows={list.data?.data} loading={list.isPending} error={list.error} rowKey={(r) => r.id} columns={[
        { header: 'Code', cell: (r) => <code>{r.code}</code> },
        { header: 'Name', cell: (r) => r.name },
        { header: 'Branch', cell: (r) => branches.find((b) => b.id === r.branch_id)?.name ?? r.branch_id },
        { header: 'Shift', cell: (r) => (r.open_session ? <Badge status="open">Open</Badge> : <span className="text-slate-400">—</span>) },
        { header: '', cell: (r) => <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ ...r, is_active: !r.is_active })}>{r.is_active ? 'Deactivate' : 'Activate'}</Button> },
      ]} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add register"
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate({ branch_id: Number(form.branch_id), code: form.code, name: form.name })}>Save</Button></>}>
        <div className="grid gap-4">
          <Field label="Branch" error={err('branch_id')}>{(id) => <Select id={id} value={form.branch_id} onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
          <Field label="Code" error={err('code')}>{(id) => <Input id={id} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="REG-2" />}</Field>
          <Field label="Name" error={err('name')}>{(id) => <Input id={id} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Register 2" />}</Field>
        </div>
      </Modal>
    </Card>
  );
}
