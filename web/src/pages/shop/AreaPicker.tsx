import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

export interface Area { code: string; name: string; hint?: string | null }
export interface AreaPath { region: Area | null; province: Area | null; city: Area | null; barangay: Area | null }
type Level = keyof AreaPath;

export const emptyAreaPath: AreaPath = { region: null, province: null, city: null, barangay: null };
const LEVELS: { key: Level; label: string; type: string }[] = [
  { key: 'region', label: 'Region', type: 'regions' },
  { key: 'province', label: 'Province', type: 'provinces' },
  { key: 'city', label: 'City', type: 'cities' },
  { key: 'barangay', label: 'Barangay', type: 'barangays' },
];

export const areaComplete = (path: AreaPath) => !!(path.region && path.province && path.city && path.barangay);
export const areaLabel = (path: AreaPath) => [path.barangay?.name, path.city?.name, path.province?.name === 'Metro Manila' ? null : path.province?.name, path.region?.name.replace(/ \(.*\)$/, '')]
  .filter(Boolean).join(', ');

/**
 * Shopee-style address area field: one box that opens a dropdown stepping through Region → Province → City →
 * Barangay, each list searchable. Lists come from the official PSGC directory (cached by the backend).
 */
export function AreaPicker({ value, onChange }: { value: AreaPath; onChange: (path: AreaPath) => void }) {
  const [open, setOpen] = useState(false);
  const firstMissing = LEVELS.find((l) => !value[l.key])?.key ?? 'barangay';
  const [level, setLevel] = useState<Level>(firstMissing);
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const index = LEVELS.findIndex((l) => l.key === level);
  const parent = index === 0 ? null : value[LEVELS[index - 1].key];
  const list = useQuery({
    queryKey: ['ph-areas', level, parent?.code ?? ''],
    queryFn: () => api<{ data: Area[] }>('/address/areas', { query: { type: LEVELS[index].type, parent: parent?.code } }),
    enabled: open && (index === 0 || !!parent),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  useEffect(() => { if (open) { setFilter(''); window.setTimeout(() => search.current?.focus(), 30); } }, [open, level]);

  const choose = (area: Area) => {
    const next: AreaPath = { ...value };
    // A new choice clears everything below it.
    LEVELS.slice(index).forEach((l) => { next[l.key] = null; });
    next[level] = area;
    onChange(next);
    if (index < LEVELS.length - 1) setLevel(LEVELS[index + 1].key);
    else setOpen(false);
  };

  const term = filter.trim().toLowerCase();
  const rows = (list.data?.data ?? []).filter((a) => !term || a.name.toLowerCase().includes(term) || (a.hint ?? '').toLowerCase().includes(term));
  const label = areaLabel(value);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => { setLevel(areaComplete(value) ? 'barangay' : firstMissing); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex min-h-12 w-full items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm outline-none transition ${open ? 'border-orange-500 ring-4 ring-orange-500/10' : 'border-slate-200 hover:border-slate-300'}`}
      >
        <span className={`min-w-0 flex-1 ${label ? 'text-slate-900' : 'text-slate-400'}`}>{label || 'Region, Province, City, Barangay'}</span>
        {label && <span role="button" tabIndex={0} aria-label="Clear area" onClick={(e) => { e.stopPropagation(); onChange(emptyAreaPath); setLevel('region'); }} className="grid size-6 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-3.5" /></span>}
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-[700] mt-1.5 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
          {/* Steps */}
          <div className="grid grid-cols-4 border-b border-slate-100" role="tablist">
            {LEVELS.map((l, i) => {
              const reachable = i === 0 || !!value[LEVELS[i - 1].key];
              const active = l.key === level;
              return (
                <button
                  key={l.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={!reachable}
                  onClick={() => setLevel(l.key)}
                  className={`relative min-w-0 px-1.5 py-2.5 text-center transition disabled:cursor-not-allowed disabled:text-slate-300 ${active ? 'text-orange-600' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-wide">{l.label}</span>
                  <span className="block truncate text-[11px] font-medium text-slate-400">{value[l.key]?.name ?? (reachable ? 'Choose' : '–')}</span>
                  {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-orange-500" />}
                </button>
              );
            })}
          </div>
          {/* Search */}
          <label className="relative block border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input ref={search} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${LEVELS[index].label.toLowerCase()}`} aria-label={`Search ${LEVELS[index].label}`} className="h-10 w-full rounded-lg bg-slate-50 pl-9 pr-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-orange-500/30" />
          </label>
          {/* Options */}
          <ul role="listbox" aria-label={LEVELS[index].label} className="max-h-64 overflow-y-auto py-1">
            {list.isPending && <li className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" /> Loading {LEVELS[index].label.toLowerCase()} list…</li>}
            {list.isError && <li className="px-4 py-5 text-center text-sm text-red-600">Could not load the list. <button type="button" onClick={() => list.refetch()} className="font-semibold underline">Try again</button></li>}
            {list.isSuccess && !rows.length && <li className="px-4 py-5 text-center text-sm text-slate-500">No match for “{filter}”.</li>}
            {rows.map((area) => {
              const selected = value[level]?.code === area.code;
              return (
                <li key={area.code}>
                  <button type="button" role="option" aria-selected={selected} onClick={() => choose(area)} className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition ${selected ? 'bg-orange-50 font-semibold text-orange-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                    <span className="min-w-0 flex-1 truncate">{area.name}</span>
                    {selected && <Check className="size-4 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
