import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, PageHeader } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Category } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function CategoriesPage() {
  const { can } = useTenant();
  const list = useTenantQuery<{ data: Category[] }>('/categories');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const remove = useTenantMutation<Category>('DELETE', (c) => `/categories/${c.id}`, { success: 'Category deleted.' });

  if (!can('products.view')) return <NoAccess what="categories" />;

  return (
    <>
      <PageHeader
        title="Categories"
        actions={can('categories.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add category</Button>}
      />
      <Card padded={false}>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(c) => c.id}
          empty="No categories yet."
          columns={[
            { header: 'Name', cell: (c) => <span className="font-medium text-slate-900">{c.name}</span> },
            { header: 'Products', cell: (c) => c.products_count ?? 0, align: 'right' },
            { header: 'Status', cell: (c) => <Badge status={c.is_active ? 'active' : 'archived'}>{c.is_active ? 'Active' : 'Inactive'}</Badge> },
            {
              header: '',
              cell: (c) =>
                can('categories.manage') && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
                    {(c.products_count ?? 0) === 0 && <Button size="sm" variant="ghost" onClick={() => remove.mutate(c)}>Delete</Button>}
                  </div>
                ),
            },
          ]}
        />
      </Card>
      <CategoryForm category={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function CategoryForm({ category, onClose }: { category: Category | 'new' | null; onClose: () => void }) {
  const isNew = category === 'new';
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  useEffect(() => {
    setName(category && category !== 'new' ? category.name : '');
    setActive(category && category !== 'new' ? category.is_active : true);
  }, [category]);
  const save = useTenantMutation<Record<string, unknown>>(isNew ? 'POST' : 'PATCH', isNew ? '/categories' : `/categories/${(category as Category | null)?.id}`, {
    success: 'Category saved.',
    onSuccess: onClose,
    toastErrors: false,
  });

  return (
    <Modal open={category !== null} onClose={onClose} title={isNew ? 'Add category' : 'Edit category'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(isNew ? { name } : { name, is_active: active })}>Save</Button></>}>
      <div className="space-y-4">
        {save.error instanceof ApiError && !save.error.field('name') && !save.error.field('slug') && <ErrorBanner error={save.error} />}
        <Field label="Name" error={save.error instanceof ApiError ? save.error.field('name') ?? save.error.field('slug') : undefined}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        {!isNew && <Checkbox label="Active" checked={active} onChange={setActive} />}
      </div>
    </Modal>
  );
}
