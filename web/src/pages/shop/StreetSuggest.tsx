import { LoaderCircle, MapPin, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type LatLng, type PlaceResult } from '../../components/maps';
import type { AreaPath } from './AreaPicker';

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bst\.?$/i, 'Street'], [/\bst\.?(?=[\s,])/gi, 'Street'], [/\bave?\.?\b/gi, 'Avenue'], [/\brd\.?\b/gi, 'Road'],
  [/\bbrgy\.?\b/gi, 'Barangay'], [/\bsubd\.?\b/gi, 'Subdivision'], [/\bvill\.?\b/gi, 'Village'], [/\bblvd\.?\b/gi, 'Boulevard'],
  [/\bhwy\.?\b/gi, 'Highway'], [/\bext\.?\b/gi, 'Extension'],
];
/** House/lot numbers mean nothing to the map, so they are left out of the search. */
const HOUSE_NUMBERS = /\b(blk|block|lot|unit|house|no|phase|ph)\.?\s*[#\d-]*\w?\b|#\s*\d+\w*|\b\d+[a-z]?\b/gi;

function cleanText(text: string) {
  let out = text.replace(HOUSE_NUMBERS, ' ');
  for (const [pattern, word] of ABBREVIATIONS) out = out.replace(pattern, word);
  return out.replace(/[,\s]+/g, ' ').trim();
}

/** The full text, then its last and first words (street names usually come last, villages first). */
function variants(text: string): string[] {
  const words = cleanText(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const list = [words.join(' ')];
  if (words.length >= 3) list.push(words.slice(-2).join(' '), words.slice(0, 2).join(' '));
  else if (words.length === 2) list.push(words[words.length - 1]);
  return [...new Set(list)].filter((v) => v.length >= 3);
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
});

const mentions = (place: PlaceResult, name?: string | null) => !!name && `${place.label}, ${place.detail}`.toLowerCase().includes(name.toLowerCase().replace(/ city$/, ''));
const inBarangay = (place: PlaceResult, area: AreaPath) => mentions(place, plainBarangay(area.barangay?.name));

const GENERIC = new Set(['street', 'avenue', 'road', 'village', 'subdivision', 'barangay', 'boulevard', 'highway', 'extension', 'city', 'the', 'of', 'and', 'purok', 'sitio', 'zone']);
/** "Barangay 19-B (Pob.)" → "19-B", the way the map names it. */
export const plainBarangay = (name?: string | null) => name?.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^Barangay\s+/i, '').trim() || null;

/**
 * Places in the chosen city that match what the customer typed. Tries the text inside their barangay, then the whole
 * city, then shortened versions of it, one request at a time (OpenStreetMap's free search allows about one a second).
 * Only results containing one of the customer's own words are kept, and their barangay is ranked first.
 */
export async function suggestStreets(text: string, area: AreaPath, near: LatLng | null, signal: AbortSignal): Promise<PlaceResult[]> {
  const city = area.city?.name ?? null;
  const barangay = plainBarangay(area.barangay?.name);
  const queries: string[] = [];
  for (const v of variants(text).slice(0, 3)) {
    if (barangay && city) queries.push(`${v}, ${barangay}, ${city}`);
    queries.push(city ? `${v}, ${city}` : v);
  }
  const found = new Map<string, PlaceResult>();
  for (const [i, query] of [...new Set(queries)].slice(0, 4).entries()) {
    if (i > 0) await wait(1100, signal);
    const words = cleanText(query.split(',')[0]).toLowerCase().split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
    const rows = await searchPlaces(query, near, signal);
    rows
      .filter((p) => !city || mentions(p, city))
      .filter((p) => !words.length || words.some((w) => `${p.label}`.toLowerCase().includes(w)))
      .forEach((p) => found.set(`${p.point.lat.toFixed(5)},${p.point.lng.toFixed(5)}`, p));
    if (found.size >= 3) break;
  }
  return [...found.values()].sort((a, b) => Number(mentions(b, barangay)) - Number(mentions(a, barangay))).slice(0, 6);
}

/**
 * The street field with live suggestions. Picking one fills the field and moves the pin; when the customer simply
 * stops typing, a match in their barangay (or the only match) is pinned automatically, unless they placed the pin by hand.
 */
export function StreetField({ value, onChange, area, near, mapSuggestion, onPick, onAutoPin }: {
  value: string;
  onChange: (value: string) => void;
  area: AreaPath;
  near: LatLng | null;
  /** Street the map found at the current pin, offered when the field is empty. */
  mapSuggestion: string;
  onPick: (place: PlaceResult) => void;
  onAutoPin: (place: PlaceResult) => void;
}) {
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState('');
  const typed = useRef(false);
  const autoPin = useRef(onAutoPin);
  autoPin.current = onAutoPin;

  useEffect(() => {
    const text = value.trim();
    if (!typed.current || cleanText(text).length < 3) { setResults([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const places = await suggestStreets(text, area, near, controller.signal);
        setResults(places);
        setActive(0);
        setSearched(text);
        const best = places[0];
        // Only pin automatically when it is clearly the right place; otherwise let the customer pick from the list.
        if (best && (inBarangay(best, area) || places.length === 1)) autoPin.current(best);
      } catch { /* aborted, or offline: the customer can still drag the map */ }
      if (!controller.signal.aborted) setLoading(false);
    }, 800);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, area.city?.code, area.barangay?.code]); // eslint-disable-line react-hooks/exhaustive-deps -- search on text or area changes only

  const choose = (place: PlaceResult) => {
    typed.current = false;
    onChange(place.label);
    setOpen(false);
    setResults([]);
    onPick(place);
  };
  const showList = open && (loading || results.length > 0 || (searched === value.trim() && value.trim().length >= 3));
  const fromMap = mapSuggestion.split(', ').slice(0, 2).join(', ');

  return (
    <div className="relative">
      <span className="text-sm font-semibold text-slate-800">Street name, building, house no.</span>
      <div className="relative mt-1.5">
        <input
          value={value}
          onChange={(e) => { typed.current = true; onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!showList || !results.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
          }}
          maxLength={200}
          placeholder="e.g. Blk 4 Lot 12, Mahogany St."
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          className="h-12 w-full rounded-xl border border-slate-200 px-3.5 pr-10 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
        />
        {loading && <LoaderCircle className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>

      {showList && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-[700] mt-1.5 max-h-72 overflow-y-auto rounded-2xl bg-white py-1 shadow-2xl ring-1 ring-slate-200">
          {loading && !results.length && <li className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" /> Looking up places in {area.city?.name ?? 'your area'}…</li>}
          {results.map((place, i) => (
            <li key={`${place.point.lat},${place.point.lng}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(place)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition ${i === active ? 'bg-orange-50' : 'hover:bg-slate-50'}`}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-orange-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{place.label}</span>
                  <span className="block truncate text-xs text-slate-500">{place.detail}</span>
                </span>
                {inBarangay(place, area) && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Your barangay</span>}
              </button>
            </li>
          ))}
          {!loading && !results.length && <li className="px-4 py-3 text-sm text-slate-500">No match on the map. Keep your address as typed and drag the pin to your door.</li>}
        </ul>
      )}

      {fromMap && !value.trim() && (
        <button type="button" onClick={() => onChange(fromMap)} className="mt-2 flex w-full items-start gap-2 rounded-xl bg-orange-50 px-3 py-2 text-left text-xs text-slate-700 ring-1 ring-orange-200 hover:bg-orange-100">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-orange-600" />
          <span className="min-w-0 flex-1">From the map: <b>{fromMap}</b></span>
          <span className="shrink-0 font-semibold text-orange-700">Use</span>
        </button>
      )}
    </div>
  );
}
