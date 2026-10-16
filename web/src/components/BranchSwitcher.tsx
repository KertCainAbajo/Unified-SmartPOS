import { Check, ChevronDown, Layers, Store } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTenant } from '../tenant/TenantProvider';
import { cx } from './ui';

/** Header dropdown: pick one branch to work in, or "All branches" to see every branch's records together. */
export function BranchSwitcher() {
  const { branches, branch, viewAll, setBranchId } = useTenant();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const pick = (id: number | 'all') => {
    setBranchId(id);
    setOpen(false);
  };
  const multi = branches.length > 1;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => multi && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Branch"
        className={cx(
          'flex h-10 max-w-[16rem] items-center gap-2 rounded-full border bg-white pl-3 pr-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition sm:max-w-xs',
          open ? 'border-brand-500 ring-4 ring-brand-100' : 'border-slate-200 hover:border-brand-300',
          !multi && 'cursor-default',
        )}
      >
        {viewAll ? <Layers className="size-4 shrink-0 text-brand-600" /> : <Store className="size-4 shrink-0 text-brand-600" />}
        <span className="truncate">{viewAll ? 'All branches' : branch?.name ?? 'No branch'}</span>
        {viewAll && <span className="rounded-full bg-brand-50 px-1.5 text-[10px] font-bold text-brand-700 ring-1 ring-brand-100">{branches.length}</span>}
        {multi && <ChevronDown className={cx('size-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />}
      </button>

      {open && (
        <div role="listbox" aria-label="Branches" className="auth-fade absolute left-0 top-12 z-40 w-72 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/10">
          <Option active={viewAll} onClick={() => pick('all')} icon={<Layers className="size-4" />} title="All branches" note={`Combined view of ${branches.length} branches`} />
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Branches</p>
          {branches.map((b) => (
            <Option key={b.id} active={!viewAll && branch?.id === b.id} onClick={() => pick(b.id)} icon={<Store className="size-4" />} title={b.name} note={viewAll && branch?.id === b.id ? 'Working branch for POS & stock actions' : undefined} />
          ))}
          {viewAll && branch && (
            <p className="mt-1 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              New sales, stock adjustments and orders still go to <strong className="text-slate-700">{branch.name}</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Option({ active, onClick, icon, title, note }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; note?: string }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition', active ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50')}
    >
      <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg', active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {note && <span className="block truncate text-[11px] text-slate-500">{note}</span>}
      </span>
      {active && <Check className="size-4 shrink-0 text-brand-600" />}
    </button>
  );
}

/** Small chip naming the branch a record belongs to; shown when viewing all branches. */
export function BranchTag({ id, className }: { id: number | null | undefined; className?: string }) {
  const { branchName } = useTenant();
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200', className)}>
      <Store className="size-3 shrink-0 text-brand-500" />
      <span className="truncate">{branchName(id)}</span>
    </span>
  );
}

/** Header chip stating which branch(es) the page is showing. */
export function ScopeChip() {
  const { viewAll, branch, branches } = useTenant();
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-3.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-900/5">
      {viewAll ? <Layers className="size-3.5 text-brand-600" /> : <Store className="size-3.5 text-brand-600" />}
      <span className="font-semibold text-slate-800">{viewAll ? `All ${branches.length} branches` : branch?.name ?? 'No branch'}</span>
    </span>
  );
}
