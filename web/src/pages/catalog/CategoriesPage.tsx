import { CheckCircle2, Download, FolderOpen, FolderTree, Layers, Package, Pencil, Plus, RotateCcw, Tags, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Checkbox, ErrorBanner, Field, FormSection, IconButton, Input, LoadingRows, Modal, PageHeader, SearchField, Segmented, StatCard, EmptyState, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Category } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';
import { useConfirm } from '../../components/Confirm';

type StatusFilter = 'all' | 'active' | 'inactive';

export function CategoriesPage() {
  const ask = useConfirm();
  const { can } = useTenant();
  const list = useTenantQuery<{ data: Category[] }>('/categories');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const remove = useTenantMutation<Category>('DELETE', (c) => `/categories/${c.id}`, { success: 'Category deleted.' });

  if (!can('products.view')) return <NoAccess what="categories" />;

  const all = list.data?.data ?? [];
  const manage = can('categories.manage');
  const needle = term.trim().toLowerCase();
  const rows = all.filter((c) => (status === 'all' || (status === 'active') === c.is_active) && (!needle || c.name.toLowerCase().includes(needle)));
  const products = all.reduce((s, c) => s + (c.products_count ?? 0), 0);
  const active = all.filter((c) => c.is_active).length;
  const unused = all.filter((c) => (c.products_count ?? 0) === 0).length;
  const largest = all.reduce<Category | null>((best, c) => ((c.products_count ?? 0) > (best?.products_count ?? 0) ? c : best), null);
  const max = Math.max(1, ...all.map((c) => c.products_count ?? 0));
  const ready = list.data !== undefined;
  const filtered = needle !== '' || status !== 'all';

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description="Group products so the register, reports and stock lists stay organised."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} disabled={all.length === 0}
              onClick={() => downloadCsv('categories.csv', ['Name', 'Products', 'Status'], all.map((c) => [c.name, c.products_count ?? 0, c.is_active ? 'Active' : 'Inactive']))}>
              Export CSV
            </Button>
            {manage && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add category</Button>}
          </>
        }
      />

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard tone="featured" icon={FolderTree} label="Categories" value={ready ? all.length : null} hint={`${active} active · ${all.length - active} inactive`} />
        <StatCard tone="brand" icon={Package} label="Products filed" value={ready ? products : null} hint={all.length ? `Avg ${(products / all.length).toFixed(1)} per category` : 'No categories yet'} />
        <StatCard tone="sun" icon={Layers} label="Largest" value={ready ? largest?.name ?? '—' : null} hint={largest ? `${largest.products_count} products` : 'Nothing filed yet'} />
        <StatCard tone={unused > 0 ? 'warn' : 'default'} icon={FolderOpen} label="Empty" value={ready ? unused : null} hint={unused > 0 ? 'Can be deleted safely' : 'Every category is in use'} />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchField className="sm:w-72" value={term} onChange={setTerm} placeholder="Search categories" />
          <Segmented<StatusFilter> label="Status" value={status} onChange={setStatus} className="sm:ml-auto"
            options={[{ value: 'all', label: `All ${all.length}` }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        </div>

        {list.error ? (
          <ErrorBanner error={list.error} className="m-4" />
        ) : !ready ? (
          <LoadingRows label="Loading categories" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={filtered ? 'No categories match' : 'No categories yet'}
            description={filtered ? 'Try another name or status.' : 'Create categories like “Beverages” or “Snacks” to group your products.'}
            action={filtered
              ? <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => { setTerm(''); setStatus('all'); }}>Reset filters</Button>
              : manage && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add category</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="sp-cards w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3 pl-5 pr-3 text-left font-semibold">Category</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Products</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Status</th>
                  <th scope="col" className="w-28 pr-5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => {
                  const count = c.products_count ?? 0;
                  return (
                    <tr key={c.id} className={cx('group transition-colors hover:bg-brand-50/40', !c.is_active && 'text-slate-400')}>
                      <td className="py-3 pl-5 pr-3">
                        <span className="flex items-center gap-3">
                          <span className={cx(!c.is_active && 'opacity-50 grayscale')}><Avatar name={c.name} square /></span>
                          <span className="min-w-0">
                            <span className={cx('block font-medium', c.is_active ? 'text-slate-900' : 'text-slate-500')}>{c.name}</span>
                            {c.description ? <span className="block max-w-xs truncate text-xs text-slate-400">{c.description}</span> : <span className="block font-mono text-[11px] text-slate-400">/{c.slug}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-3">
                          <span className="w-8 text-right font-display font-semibold tabular-nums text-slate-900">{count}</span>
                          <span className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-slate-100 sm:block">
                            <span className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-500" style={{ width: `${(count / max) * 100}%` }} />
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge status={c.is_active ? 'active' : 'archived'}>{c.is_active ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="pr-5 text-right">
                        {manage && (
                          <span className="inline-flex gap-1 opacity-70 transition group-hover:opacity-100">
                            <IconButton label={`Edit ${c.name}`} icon={Pencil} onClick={() => setEditing(c)} />
                            <IconButton label={count === 0 ? `Delete ${c.name}` : 'Move or archive its products first'} icon={Trash2} tone="danger" disabled={count > 0}
                              onClick={async () => { if (await ask({ title: `Delete the “${c.name}” category?`, message: 'This cannot be undone. A category that still has products cannot be deleted; deactivate it instead.', confirmLabel: 'Delete' })) remove.mutate(c); }} />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
              Showing {rows.length} of {all.length} {all.length === 1 ? 'category' : 'categories'}
            </p>
          </div>
        )}
      </section>
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
  const count = category && category !== 'new' ? category.products_count ?? 0 : 0;
  const submit = () => name.trim() && save.mutate(isNew ? { name } : { name, is_active: active });

  return (
    <Modal open={category !== null} onClose={onClose} title={isNew ? 'Add category' : 'Edit category'} icon={Tags} size="sm"
      description={isNew ? 'Products can be filed under it right away.' : `${count} ${count === 1 ? 'product' : 'products'} filed here.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} loading={save.isPending} onClick={submit}>{isNew ? 'Create category' : 'Save changes'}</Button></>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-brand-50 to-cream/60 p-3 ring-1 ring-brand-100">
          <span className={cx(!active && 'opacity-50 grayscale')}><Avatar name={name || '?'} square /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-semibold text-slate-900">{name.trim() || 'Category name'}</p>
            <p className="text-xs text-slate-500">Preview</p>
          </div>
          {active ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-3.5" /> Active</span> : <Badge status="archived">Inactive</Badge>}
        </div>
        {save.error instanceof ApiError && !save.error.field('name') && !save.error.field('slug') && <ErrorBanner error={save.error} />}
        <FormSection title="Details">
          <Field label="Name" hint="Shown on the register and in reports." error={save.error instanceof ApiError ? save.error.field('name') ?? save.error.field('slug') : undefined}>
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beverages" autoFocus />}
          </Field>
          {!isNew && <Checkbox label="Active — available when adding products" checked={active} onChange={setActive} />}
        </FormSection>
      </form>
    </Modal>
  );
}
