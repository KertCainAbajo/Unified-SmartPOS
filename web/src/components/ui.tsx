import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { errorMessage } from '../lib/api';
import { titleCase } from '../lib/format';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/* ---------------------------------------------------------------- Buttons */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-700/20 ring-1 ring-brand-800/20 hover:to-brand-600 focus-visible:outline-brand-600 disabled:opacity-50',
  secondary: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600 disabled:bg-red-600/50',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-400 disabled:text-slate-400',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-base gap-2' };
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-xl font-semibold transition duration-150 ease-out enabled:active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed',
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Form fields */

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string) => ReactNode;
  className?: string;
}

export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const control =
  'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50 aria-[invalid=true]:border-red-500';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(control, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(control, 'h-auto min-h-20 py-2', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select className={cx(control, 'cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="size-4 rounded border-slate-300 accent-brand-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** On/off toggle with a label and optional description. */
export function Switch({ label, description, checked, onChange, disabled, tone = 'brand' }: { label: string; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; tone?: 'brand' | 'warn' }) {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-4 rounded-xl p-3 transition hover:bg-slate-50', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
          checked ? (tone === 'warn' ? 'bg-amber-500' : 'bg-brand-600') : 'bg-slate-200',
        )}
      >
        <span className={cx('inline-block size-5 rounded-full bg-white shadow-sm ring-1 ring-slate-900/5 transition', checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

/* ---------------------------------------------------------------- Layout pieces */

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p>}
        <h1 className={cx('font-display text-[1.75rem] font-bold leading-tight tracking-tight text-brand-900', eyebrow && 'mt-1')}>{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, icon: Icon, actions, children, className, padded = true }: { title?: string; subtitle?: ReactNode; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          {title && (
            <div className="flex min-w-0 items-center gap-3">
              {Icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100"><Icon className="size-4" /></span>}
              <div className="min-w-0">
                <h2 className="font-display text-sm font-semibold text-slate-900">{title}</h2>
                {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
              </div>
            </div>
          )}
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

const statTints = {
  default: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-50 text-brand-600',
  sun: 'bg-sun-300/30 text-sun-500',
  sky: 'bg-sky-50 text-sky-600',
  rose: 'bg-rose-50 text-rose-600',
  warn: 'bg-amber-50 text-amber-600',
};

/**
 * KPI tile. `tone="featured"` renders the brand-green headline card; `value={null}` shows a loading placeholder.
 */
export function StatCard({ label, value, hint, tone = 'default', icon: Icon }: { label: string; value: ReactNode | null; hint?: ReactNode; tone?: keyof typeof statTints | 'featured'; icon?: LucideIcon }) {
  if (tone === 'featured') {
    return (
      <div className="relative min-w-0 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-3.5 text-white shadow-md shadow-brand-900/20 sm:p-5">
        <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-sun-400/20 blur-xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-12 -left-6 size-28 rounded-full bg-white/5" />
        <div className="relative flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-brand-100 sm:text-[11px]">{label}</p>
          {Icon && <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/15 text-sun-300 sm:size-9"><Icon className="size-4" /></span>}
        </div>
        {value === null ? <span className="relative mt-3 block h-8 w-32 animate-pulse rounded-lg bg-white/15" /> : <p className="relative mt-1.5 truncate font-display text-xl font-bold leading-tight tabular-nums sm:mt-2 sm:text-[1.65rem]">{value}</p>}
        {hint && <p className="relative mt-1 truncate text-xs text-brand-100/80">{hint}</p>}
      </div>
    );
  }
  return (
    <div className={cx('min-w-0 rounded-2xl bg-white p-3.5 shadow-sm ring-1 transition hover:shadow-md sm:p-5', tone === 'warn' ? 'ring-amber-200' : 'ring-slate-900/5')}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-[11px]">{label}</p>
        {Icon && <span className={cx('grid size-8 shrink-0 place-items-center rounded-xl sm:size-9', statTints[tone])}><Icon className="size-4" /></span>}
      </div>
      {value === null ? (
        <span className="mt-3 block h-8 w-28 animate-pulse rounded-lg bg-slate-100" />
      ) : (
        <p className={cx('mt-1.5 truncate font-display text-xl font-bold leading-tight tabular-nums sm:mt-2 sm:text-[1.65rem]', tone === 'rose' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900')}>{value}</p>
      )}
      {hint && <p className="mt-1 truncate text-[11px] text-slate-400 sm:text-xs">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- Toolbar controls */

/** Search box with icon and clear button, used in table toolbars. */
export function SearchField({ value, onChange, placeholder = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cx('group relative flex h-10 items-center rounded-xl bg-slate-50 ring-1 ring-slate-200 transition focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500', className)}>
      <Search className="pointer-events-none ml-3 size-4 shrink-0 text-slate-400 transition group-focus-within:text-brand-600" />
      <input className="h-full w-full min-w-0 bg-transparent pl-2.5 pr-8 text-sm outline-none placeholder:text-slate-400" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2 grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700">
          <X className="size-3.5" />
        </button>
      )}
    </label>
  );
}

/** Segmented pill control. */
export function Segmented<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-slate-100 p-1 text-xs font-medium', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-lg px-3 transition', value === o.value ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact from → to date picker that fits in a toolbar. */
export function DateRange({ from, to, onChange, className }: { from: string; to: string; onChange: (range: { from: string; to: string }) => void; className?: string }) {
  return (
    <div className={cx('flex h-10 items-center gap-1 rounded-xl bg-slate-50 px-2 ring-1 ring-slate-200 transition focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500', className)}>
      <CalendarDays className="size-4 shrink-0 text-slate-400" />
      <input type="date" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} aria-label="From date" className="h-full min-w-0 bg-transparent px-1 text-xs font-medium text-slate-700 outline-none" />
      <span className="text-xs text-slate-400">→</span>
      <input type="date" value={to} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} aria-label="To date" className="h-full min-w-0 bg-transparent px-1 text-xs font-medium text-slate-700 outline-none" />
    </div>
  );
}

/** Rounded icon-only action button used in table rows. */
export function IconButton({ label, icon: Icon, onClick, tone = 'default', disabled }: { label: string; icon: LucideIcon; onClick: () => void; tone?: 'default' | 'danger'; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cx(
        'grid size-8 place-items-center rounded-lg text-slate-400 ring-1 ring-transparent transition disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'danger' ? 'hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-100' : 'hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-100',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Labelled group inside a modal form. */
export function FormSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cx('space-y-4', className)}>
      <legend className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Coloured initials tile; the colour is stable for the same text. */
const tileColors = [
  'from-brand-400 to-brand-700',
  'from-sky-400 to-sky-700',
  'from-amber-400 to-orange-600',
  'from-violet-400 to-violet-700',
  'from-rose-400 to-rose-600',
  'from-teal-400 to-emerald-700',
];
export function Avatar({ name, size = 'md', square }: { name: string; size?: 'sm' | 'md'; square?: boolean }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span className={cx('grid shrink-0 place-items-center bg-gradient-to-br font-bold text-white shadow-sm', tileColors[hash % tileColors.length], square ? 'rounded-xl' : 'rounded-full', size === 'sm' ? 'size-7 text-[10px]' : 'size-9 text-xs')}>
      {letters}
    </span>
  );
}

/** Skeleton rows shown while a table loads. */
export function LoadingRows({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="divide-y divide-slate-100" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4" style={{ opacity: 1 - i * 0.12 }}>
          <span className="size-8 animate-pulse rounded-lg bg-slate-100" />
          <span className="h-3 w-40 animate-pulse rounded bg-slate-100" />
          <span className="hidden h-3 w-24 animate-pulse rounded bg-slate-100 sm:block" />
          <span className="ml-auto h-3 w-20 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  received: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  open: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending_approval: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  partially_refunded: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  partially_received: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  in_transit: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  ordered: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  draft: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  closed: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  voided: 'bg-red-50 text-red-700 ring-red-600/20',
  refunded: 'bg-red-50 text-red-700 ring-red-600/20',
  rejected: 'bg-red-50 text-red-700 ring-red-600/20',
  cancelled: 'bg-red-50 text-red-700 ring-red-600/20',
  archived: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  suspended: 'bg-red-50 text-red-700 ring-red-600/20',
};

export function Badge({ status, children }: { status?: string; children?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', badgeTones[status ?? ''] ?? 'bg-slate-100 text-slate-700 ring-slate-500/20')}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {children ?? titleCase(status ?? '')}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="relative grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        <Icon className="size-6" />
        <span aria-hidden className="absolute -right-1 -top-1 size-3 rounded-full bg-sun-400 ring-2 ring-white" />
      </span>
      <p className="mt-4 font-display font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div role="alert" key={errorMessage(error)} className={cx('sp-alert-in sp-alert-error flex items-start gap-3 rounded-2xl bg-gradient-to-r from-rose-50 to-white p-3 text-sm ring-1 ring-rose-200/80', className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-rose-500 text-white shadow-sm shadow-rose-500/30"><AlertCircle className="size-4" /></span>
      <span className="min-w-0 pt-0.5">
        <span className="block font-semibold text-rose-900">Something needs your attention</span>
        <span className="mt-0.5 block text-rose-800/90">{errorMessage(error)}</span>
      </span>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; icon?: LucideIcon; count?: number }[] }) {
  return (
    <div className="mb-5 max-w-full overflow-x-auto">
      <div className="inline-flex gap-1 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-900/5" role="tablist">
        {tabs.map((t) => {
          const active = value === t.value;
          return (
            <button
              key={t.value}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={cx(
                'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition',
                active ? 'bg-brand-700 text-white shadow-sm shadow-brand-900/20' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
              )}
            >
              {t.icon && <t.icon className={cx('size-4', active ? 'text-sun-300' : 'text-slate-400')} />}
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={cx('rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800')}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  description,
  icon: Icon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  description?: ReactNode;
  icon?: LucideIcon;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-2xl p-0 shadow-2xl shadow-brand-900/20 backdrop:bg-brand-900/40 backdrop:backdrop-blur-sm', widths[size])}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              {Icon && (
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-900/20">
                  <Icon className="size-5" />
                </span>
              )}
              <div className="min-w-0">
                <h2 id={titleId} className="truncate font-display font-semibold text-slate-900">{title}</h2>
                {description && <p id={descriptionId} className="mt-0.5 text-xs text-slate-500">{description}</p>}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="size-5" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/* ---------------------------------------------------------------- Table */

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  empty = 'Nothing here yet.',
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: unknown;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  if (error) return <ErrorBanner error={error} className="m-4" />;
  if (loading && !rows) return <LoadingRows />;
  if (!rows || rows.length === 0) return typeof empty === 'string' ? <EmptyState title={empty} /> : <>{empty}</>;

  return (
    <div className="overflow-x-auto">
      <table className="sp-cards w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400">
            {columns.map((c, i) => (
              <th key={c.header || i} scope="col" className={cx('whitespace-nowrap px-5 py-3 font-semibold', c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
            {onRowClick && <th scope="col" className="w-10" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx('group transition-colors', onRowClick ? 'cursor-pointer hover:bg-brand-50/50 focus-visible:bg-brand-50/60 focus-visible:outline-none' : 'hover:bg-slate-50/60')}
            >
              {columns.map((c, i) => (
                <td key={c.header || i} className={cx('px-5 py-3.5 align-middle text-slate-700', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
              {onRowClick && (
                <td className="pr-4 text-right">
                  <ChevronRight className="inline size-4 -translate-x-1 text-slate-300 opacity-0 transition group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100" />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Works with both Laravel resource pagination ({meta}) and plain paginator JSON. */
export function Pagination({ page, data, onPage }: { page: number; data?: { meta?: { last_page: number; total: number }; last_page?: number; total?: number }; onPage: (p: number) => void }) {
  const last = data?.meta?.last_page ?? data?.last_page ?? 1;
  const total = data?.meta?.total ?? data?.total;
  if (last <= 1) return total !== undefined ? <p className="border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">{total} result{total === 1 ? '' : 's'}</p> : null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
      <span className="text-xs text-slate-500">
        Page {page} of {last} {total !== undefined && `· ${total} results`}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" icon={<ChevronLeft className="size-4" />} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= last} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export { cx };
