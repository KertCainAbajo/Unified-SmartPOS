import { ArrowLeft, Check, Home, LoaderCircle, MapPin, MessageSquareText, Search, Store, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { matchArea } from './areaMatch';
import { LocationPicker, distanceKm, formatKm, searchPlaces, type AddressParts, type LatLng, type PlaceResult } from '../../components/maps';
import { AreaPicker, areaComplete, emptyAreaPath, type AreaPath } from './AreaPicker';
import { StreetField, plainBarangay } from './StreetSuggest';

export interface DeliveryLocation extends AreaPath {
  /** Street name, building and house/unit number. */
  street: string;
  postal: string;
  /** Landmark or instructions for the rider. */
  note: string;
  pin: LatLng | null;
}

export const emptyLocation: DeliveryLocation = { ...emptyAreaPath, street: '', postal: '', note: '', pin: null };

/** Reads a saved address, ignoring anything from older versions of the form. */
export function loadLocation(raw: string | null): DeliveryLocation {
  try {
    const saved = JSON.parse(raw ?? '{}') as Partial<DeliveryLocation>;
    return saved.barangay ? { ...emptyLocation, ...saved } : emptyLocation;
  } catch {
    return emptyLocation;
  }
}

/** What the store and rider receive, written like a Philippine mailing address. */
export function composeAddress(loc: DeliveryLocation): string {
  if (!loc.barangay || !loc.street.trim()) return '';
  const province = loc.province?.name === 'Metro Manila' ? 'Metro Manila' : loc.province?.name;
  const city = [loc.city?.name, loc.postal.trim()].filter(Boolean).join(' ');
  return [loc.street.trim(), `Brgy. ${loc.barangay.name}`, city, province].filter(Boolean).join(', ');
}

/**
 * Full-screen delivery address form. Shopee-style dropdowns pick the region, province, city and barangay; the map
 * (like Foodpanda) then puts the pin exactly on the door, so the rider can find it and the customer can track them.
 */
export function DeliveryLocationDialog({ initial, store, storeName, hasSavedHome, homeMode, onClose, onSave }: {
  initial: DeliveryLocation;
  store: LatLng | null;
  storeName?: string;
  hasSavedHome: boolean;
  homeMode: boolean;
  onClose: () => void;
  onSave: (location: DeliveryLocation, saveAsHome: boolean) => void;
}) {
  const [area, setArea] = useState<AreaPath>({ region: initial.region, province: initial.province, city: initial.city, barangay: initial.barangay });
  const [pin, setPin] = useState<LatLng | null>(initial.pin);
  /** True once the customer drags the map or uses their location: typing then no longer moves their pin. */
  const [pinByHand, setPinByHand] = useState(false);
  const [pinNotice, setPinNotice] = useState('');
  const automaticUntil = useRef(0);
  /** Moves the map and pin for the customer (search pick, barangay, typed street). */
  const moves = useRef(0);
  const moveTo = (point: LatLng, notice = '') => {
    moves.current++;
    automaticUntil.current = Date.now() + 2000;
    setFlyTo({ ...point });
    setPinNotice(notice);
  };
  const [resolving, setResolving] = useState(false);
  /** True while the street field holds what the map found (not something the customer typed). */
  const streetFromMap = useRef(!initial.street);
  /** True when the pin was last moved by the customer (drag, "Use my location", map search): its address then fills the area fields. */
  const fillArea = useRef(false);
  const [areaFilled, setAreaFilled] = useState<'idle' | 'finding' | 'done' | 'partial'>('idle');
  const queryClient = useQueryClient();
  const onPinChange = (point: LatLng) => {
    setPin(point);
    setResolving(true);
    if (Date.now() > automaticUntil.current) {
      setPinByHand(true);
      setPinNotice('');
      fillArea.current = true;
      // A manually moved pin is a new delivery location, so don't keep showing the prior address's street.
      streetFromMap.current = true;
      setStreet('');
    }
  };
  const [street, setStreet] = useState(initial.street);
  const [postal, setPostal] = useState(initial.postal);
  const [note, setNote] = useState(initial.note);
  const [saveAsHome, setSaveAsHome] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const onResolved = (address: string, parts?: AddressParts) => {
    setSuggestion(address);
    setResolving(false);
    if (parts && fillArea.current) {
      fillArea.current = false;
      setAreaFilled('finding');
      matchArea(parts, queryClient).then((found) => {
        if (!found) { setAreaFilled('idle'); return; }
        setArea(found.area);
        if (found.postal && /^\d{4}$/.test(found.postal)) setPostal(found.postal);
        setAreaFilled(found.area.barangay ? 'done' : 'partial');
      }).catch(() => setAreaFilled('idle'));
    }
    // Fill the street from where the pin stopped, unless the customer typed their own.
    const streetPart = address.split(', ').slice(0, 2).join(', ');
    if (streetPart && streetFromMap.current) setStreet(streetPart);
  };
  const typeStreet = (value: string) => { streetFromMap.current = value.trim() === ''; setStreet(value); };
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);
  const [locatingArea, setLocatingArea] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Map search, debounced so OpenStreetMap's free geocoder sees at most about one request a second.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try { setResults(await searchPlaces(text, pin ?? store, controller.signal)); } catch { /* offline: drag the map instead */ }
      setSearching(false);
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps -- search only when the text changes

  /** After a barangay is chosen, centre the map on it so the customer only has to fine-tune the pin. */
  async function changeArea(next: AreaPath) {
    fillArea.current = false;
    setAreaFilled('idle');
    const barangayChanged = next.barangay?.code !== area.barangay?.code;
    setArea(next);
    if (barangayChanged) {
      // Changing the barangay invalidates a street saved for the previous area.
      streetFromMap.current = true;
      setStreet('');
    }
    if (!next.barangay || !barangayChanged) return;
    setLocatingArea(true);
    const movesBefore = moves.current;
    try {
      const barangay = plainBarangay(next.barangay.name);
      const near = (await searchPlaces([barangay, next.city?.name].filter(Boolean).join(', ')))[0]
        ?? (await searchPlaces(next.city?.name ?? ''))[0];
      // Skip if the pin moved meanwhile (e.g. the customer already picked their street).
      if (near && moves.current === movesBefore) { moveTo(near.point); setPinByHand(false); }
    } catch { /* the customer can still move the map */ }
    setLocatingArea(false);
  }

  const pick = (place: PlaceResult) => {
    moveTo(place.point);
    fillArea.current = true;
    setStreet(place.label);
    streetFromMap.current = false;
    setQuery('');
    setResults([]);
  };
  const km = pin && store ? distanceKm(store, pin) : null;
  const location: DeliveryLocation = { ...area, street: street.trim(), postal: postal.trim(), note: note.trim(), pin };
  const missing = !areaComplete(area) ? 'Choose your region, province, city and barangay'
    : street.trim().length < 3 ? 'Enter your street name, building or house no.'
      : !pin ? 'Put the pin on your door'
        : '';

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white lg:flex-row" role="dialog" aria-modal="true" aria-label="Delivery address">
      {/* Map */}
      <div className="relative h-[45vh] shrink-0 lg:h-full lg:flex-1">
        <LocationPicker
          bare
          height="100%"
          value={pin}
          onChange={onPinChange}
          start={store}
          flyTo={flyTo}
          onResolvedAddress={onResolved}
          overlay={
            <>
            {/* Live address bubble above the centre pin. */}
            {pin && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-[550] -translate-x-1/2 -translate-y-[4.75rem]">
                <div key={resolving ? 'finding' : suggestion} className="sp-alert-in max-w-[min(80vw,22rem)] rounded-xl bg-slate-900/90 px-3 py-2 text-center text-xs text-white shadow-xl backdrop-blur">
                  {resolving
                    ? <span className="inline-flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" />Finding address…</span>
                    : <><span className="block font-semibold">{suggestion.split(', ').slice(0, 2).join(', ') || 'Pinned here'}</span>{suggestion.split(', ').length > 2 && <span className="block truncate text-[11px] text-slate-300">{suggestion.split(', ').slice(2).join(', ')}</span>}</>}
                </div>
                <span className="mx-auto block size-2 -translate-y-1 rotate-45 bg-slate-900/90" />
              </div>
            )}
            <div className="absolute inset-x-3 top-3 z-[600] sm:inset-x-5 sm:top-5 lg:right-auto lg:w-[460px]">
              <div className="flex items-center gap-2 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200">
                <button type="button" onClick={onClose} aria-label="Back to basket" className="grid size-10 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden"><ArrowLeft className="size-5" /></button>
                <label className="relative flex min-w-0 flex-1 items-center">
                  <Search className="pointer-events-none absolute left-3 size-4 text-slate-400" />
                  <input ref={searchBox} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a street or landmark on the map" aria-label="Search the map" className="h-11 w-full rounded-xl bg-slate-50 pl-9 pr-9 text-sm outline-none ring-orange-500/20 focus:bg-white focus:ring-4" />
                  {searching ? <LoaderCircle className="absolute right-3 size-4 animate-spin text-slate-400" />
                    : query && <button type="button" onClick={() => { setQuery(''); searchBox.current?.focus(); }} aria-label="Clear search" className="absolute right-2 grid size-7 place-items-center rounded-full text-slate-400 hover:bg-slate-200"><X className="size-4" /></button>}
                </label>
              </div>
              {(results.length > 0 || (query.trim().length >= 3 && !searching)) && (
                <ul className="mt-2 max-h-72 overflow-y-auto rounded-2xl bg-white py-1 shadow-xl ring-1 ring-slate-200">
                  {results.map((place, i) => (
                    <li key={`${place.point.lat},${place.point.lng},${i}`}>
                      <button type="button" onClick={() => pick(place)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-orange-50">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-orange-500" />
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{place.label}</span><span className="block truncate text-xs text-slate-500">{place.detail}</span></span>
                      </button>
                    </li>
                  ))}
                  {!results.length && <li className="px-4 py-3 text-sm text-slate-500">No places found. Try a nearby street or landmark, or drag the map.</li>}
                </ul>
              )}
              {locatingArea && <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow ring-1 ring-slate-200"><LoaderCircle className="size-3.5 animate-spin" /> Moving the map to your barangay…</p>}
            </div>
            </>
          }
        />
      </div>

      {/* Address form */}
      <aside className="flex min-h-0 flex-1 flex-col lg:w-[460px] lg:flex-none lg:border-l lg:border-slate-200">
        <div className="hidden items-center justify-between border-b border-slate-100 px-6 py-4 lg:flex">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to basket</button>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="size-4" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-orange-600">Delivery address</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">Where should we deliver?</h2>
            <p className="mt-1 text-sm text-slate-500">Choose your area, add your street and house no., then check the pin is on your door.</p>
          </div>

          <div className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-800">Region, Province, City, Barangay</span>
            <AreaPicker value={area} onChange={(next) => void changeArea(next)} />
            {areaFilled === 'finding' && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><LoaderCircle className="size-3.5 animate-spin" /> Filling in the address from the pin…</p>}
            {areaFilled === 'done' && <p className="sp-alert-in mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700"><Check className="size-3.5" /> Filled in from where you put the pin. Change it if it is wrong.</p>}
            {areaFilled === 'partial' && <p className="sp-alert-in mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700"><MapPin className="size-3.5" /> Filled in what the map knows. Please choose your barangay.</p>}
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Postal code <span className="font-normal text-slate-400">(optional)</span></span>
            <input value={postal} onChange={(e) => setPostal(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="e.g. 8000" className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 px-3.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10" />
          </label>

          <StreetField
            value={street}
            onChange={typeStreet}
            area={area}
            near={pin ?? store}
            mapSuggestion={suggestion}
            onPick={(place) => moveTo(place.point, `Pinned at ${place.label}`)}
            onAutoPin={(place) => { if (!pinByHand) moveTo(place.point, `Pin moved to ${place.label}. Drag the map if it is not your door.`); }}
          />
          {pinNotice && <p className="-mt-3 flex items-start gap-1.5 text-xs font-medium text-emerald-700"><MapPin className="mt-px size-3.5 shrink-0" /> {pinNotice}</p>}

          <div className={`flex gap-3 rounded-2xl p-4 ring-1 ${pin ? 'bg-orange-50/70 ring-orange-200' : 'bg-slate-50 ring-slate-200'}`}>
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${pin ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-400'}`}><Home className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-500">{pin ? 'Pin on the map' : 'No pin yet'}</p>
              <p className="text-sm font-semibold text-slate-900">{!pin ? 'Choose your barangay, or move the map, search, or use your location.' : resolving ? 'Finding the address at the pin…' : suggestion || 'Drag the map if the pin is not exactly on your door.'}</p>
              {pin && suggestion && !resolving && <p className="mt-0.5 text-xs text-slate-500">Drag the map if the pin is not exactly on your door.</p>}
              {km != null && <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><Store className="size-3.5" /> {formatKm(km)} from {storeName ?? 'the store'}{km > 15 && <b className="ml-1 text-amber-700">· far from this branch</b>}</p>}
            </div>
            {pin && <Check className="size-5 shrink-0 text-emerald-600" />}
          </div>

          <label className="block">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><MessageSquareText className="size-4 text-slate-400" /> Note to rider <span className="font-normal text-slate-400">(optional)</span></span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} placeholder="Landmark, gate colour, call when outside…" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10" />
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
            <input type="checkbox" checked={homeMode || saveAsHome} disabled={homeMode} onChange={(event) => setSaveAsHome(event.target.checked)} className="mt-0.5 size-4 accent-emerald-700 disabled:cursor-default" />
            <span><span className="block text-sm font-semibold text-slate-800">{homeMode ? 'This is your permanent home address' : hasSavedHome ? 'Save this as my new home address' : 'Save as my home address'}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{homeMode ? 'Saving changes here updates your saved home address.' : 'Leave this unchecked for a one-time delivery. Your saved home address will stay unchanged.'}</span></span>
          </label>
        </div>
        <div className="border-t border-slate-100 bg-white p-4 sm:px-6">
          <button
            type="button"
            disabled={!!missing}
            onClick={() => onSave(location, homeMode || saveAsHome)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
          >
            {!missing && <Check className="size-5" />} {missing || 'Save address'}
          </button>
        </div>
      </aside>
    </div>
  );
}
