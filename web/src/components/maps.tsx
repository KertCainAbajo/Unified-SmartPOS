import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Bike, Crosshair, House, LoaderCircle, LocateFixed, MapPin, Store } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';

/**
 * Maps for online-order delivery, drawn with Leaflet on free OpenStreetMap tiles.
 * No API key or billing account is needed.
 */

export interface LatLng { lat: number; lng: number }

/** Philippines-wide fallback when nothing better is known (Manila). */
export const DEFAULT_CENTER: LatLng = { lat: 14.5995, lng: 120.9842 };

// Standard OpenStreetMap tiles: free, no key. Fine for a store's traffic; a busy deployment should use a tile provider.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Straight-line distance in kilometres. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Rough arrival estimate for a motorbike in city traffic: road distance ≈ 1.35 × straight line, 22 km/h. */
export function etaMinutes(km: number): number {
  return Math.max(2, Math.round(((km * 1.35) / 22) * 60));
}

export const formatKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

export const toLatLng = (lat: number | null | undefined, lng: number | null | undefined): LatLng | null =>
  lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng)) ? null : { lat: Number(lat), lng: Number(lng) };

/** Google Maps directions to a point, for riders. */
export const directionsUrl = (to: LatLng) => `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`;

function pinIcon(kind: 'store' | 'home' | 'rider'): L.DivIcon {
  const look = {
    store: { bg: '#065f46', icon: <Store size={16} color="#fff" strokeWidth={2.4} /> },
    home: { bg: '#ea580c', icon: <House size={16} color="#fff" strokeWidth={2.4} /> },
    rider: { bg: '#e11d48', icon: <Bike size={16} color="#fff" strokeWidth={2.4} /> },
  }[kind];
  const html = renderToStaticMarkup(
    <div className={`smartpos-pin smartpos-pin--${kind}`} style={{ background: look.bg }}>{look.icon}</div>,
  );
  return L.divIcon({ html, className: '', iconSize: [36, 36], iconAnchor: [18, 36], tooltipAnchor: [0, -34] });
}

/** Maps inside dialogs are created before they have a size; re-measure once visible and whenever the box resizes. */
function ResizeFix() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const timer = window.setTimeout(() => map.invalidateSize(), 250);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize());
    observer?.observe(container);
    return () => { window.clearTimeout(timer); observer?.disconnect(); };
  }, [map]);
  return null;
}

/** Keeps every given point in view as they move (e.g. the rider). */
function FitTo({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 16));
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [42, 42], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when a point actually moves
  }, [map, key]);
  return null;
}

/**
 * Store, customer's home and (while on the way) the rider, joined by the route the rider is taking. Pass `rider`
 * as it updates to see it move.
 */
export function DeliveryMap({ store, home, rider, height = 280, className = '', bare = false, interactive = false, preview = false }: {
  store?: LatLng | null;
  home?: LatLng | null;
  rider?: LatLng | null;
  /** Pixels, or any CSS length such as '100%' to fill the parent. */
  height?: number | string;
  className?: string;
  /** No rounded frame, for full-bleed layouts. */
  bare?: boolean;
  /** Allow scroll-wheel zoom (full-screen maps). */
  interactive?: boolean;
  /** Static thumbnail: no controls, dragging or zooming. */
  preview?: boolean;
}) {
  const icons = useMemo(() => ({ store: pinIcon('store'), home: pinIcon('home'), rider: pinIcon('rider') }), []);
  const points = [store, rider, home].filter((p): p is LatLng => !!p);
  const center = home ?? store ?? rider ?? DEFAULT_CENTER;
  const done = rider && store ? [store, rider] : null;
  const ahead = home ? [rider ?? store, home].filter((p): p is LatLng => !!p) : null;

  return (
    <div className={`isolate overflow-hidden ${bare ? '' : 'rounded-2xl ring-1 ring-slate-200'} ${className}`} style={{ height }}>
      <MapContainer center={center} zoom={preview ? 16 : 14} scrollWheelZoom={interactive} className="size-full" attributionControl={!preview} zoomControl={!bare}
        dragging={!preview} doubleClickZoom={!preview} touchZoom={!preview} keyboard={!preview} boxZoom={!preview}>
        <TileLayer url={TILES} attribution={ATTRIBUTION} />
        {/* Full-screen maps keep the top-left corner for their own back/search controls. */}
        {bare && !preview && <ZoomControl position="topright" />}
        {done && <Polyline positions={done} pathOptions={{ color: '#059669', weight: 4, opacity: 0.55 }} />}
        {ahead && ahead.length === 2 && <Polyline positions={ahead} pathOptions={{ color: '#e11d48', weight: 4, dashArray: '2 9', lineCap: 'round' }} />}
        {store && <Marker position={store} icon={icons.store}><Tooltip direction="top">Store</Tooltip></Marker>}
        {home && <Marker position={home} icon={icons.home}><Tooltip direction="top">Delivery spot</Tooltip></Marker>}
        {rider && <Marker position={rider} icon={icons.rider} zIndexOffset={1000}><Tooltip direction="top" permanent>Rider</Tooltip></Marker>}
        <FitTo points={points} />
        <ResizeFix />
      </MapContainer>
    </div>
  );
}

/**
 * Reports the map centre only after the person moves the map. Leaflet also fires "moveend" when the map first
 * loads or re-measures, and reporting those would silently replace a saved location with wherever the map opened.
 */
function CenterTracker({ onMove }: { onMove: (center: LatLng) => void }) {
  const touched = useRef(false);
  const map = useMapEvents({
    dragstart: () => { touched.current = true; },
    zoomstart: () => { touched.current = true; },
    moveend: () => { if (touched.current) onMove(map.getCenter()); },
  });
  return null;
}

function Recenter({ to }: { to: LatLng | null }) {
  const map = useMap();
  useEffect(() => { if (to) map.setView(to, Math.max(map.getZoom(), 17)); }, [map, to]);
  return null;
}

export interface PlaceResult { label: string; detail: string; point: LatLng }

const cleanParts = (name: string) => name.split(', ').filter((part) => !/^\d{4}$/.test(part) && part !== 'Philippines');

/** The parts of an address OpenStreetMap knows at a point, used to fill the region/province/city/barangay fields. */
export interface AddressParts { region?: string; province?: string; city?: string; barangays: string[]; postcode?: string }

/** Street address at a point (OpenStreetMap Nominatim). Returns '' when nothing useful is found. */
export async function reverseGeocode(point: LatLng, signal?: AbortSignal): Promise<string> {
  return (await reverseGeocodeDetails(point, signal)).label;
}

/** Street address at a point plus its region, province, city, barangay and postal code. */
export async function reverseGeocodeDetails(point: LatLng, signal?: AbortSignal): Promise<{ label: string; parts: AddressParts }> {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${point.lat}&lon=${point.lng}`, { headers: { Accept: 'application/json' }, signal });
  const json = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  const a = json.address ?? {};
  return {
    label: json.display_name ? cleanParts(json.display_name).slice(0, 5).join(', ') : '',
    parts: {
      region: a.region, province: a.province ?? a.state ?? a.county, city: a.city ?? a.town ?? a.municipality,
      // Barangays appear under different keys depending on the area; the most specific come first.
      barangays: [a.quarter, a.village, a.neighbourhood, a.suburb, a.hamlet, a.city_district].filter((v): v is string => !!v),
      postcode: a.postcode,
    },
  };
}

/** Places matching typed text, Philippines only, nearer `near` first when given. */
export async function searchPlaces(text: string, near?: LatLng | null, signal?: AbortSignal): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ format: 'jsonv2', q: text, countrycodes: 'ph', limit: '6', addressdetails: '0' });
  if (near) params.set('viewbox', `${near.lng - 0.35},${near.lat + 0.35},${near.lng + 0.35},${near.lat - 0.35}`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' }, signal });
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => {
    const parts = cleanParts(r.display_name);
    return { label: parts.slice(0, 2).join(', '), detail: parts.slice(2, 6).join(', '), point: { lat: Number(r.lat), lng: Number(r.lon) } };
  });
}

/**
 * Drag the map so the pin in the middle sits exactly on the delivery spot (like Grab or Foodpanda). Also offers
 * "Use my current location". Reports the pinned point and, when asked, the street address at the pin.
 */
export function LocationPicker({ value, onChange, start, onAddress, onResolvedAddress, flyTo, height = 240, bare = false, overlay, footer }: {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
  /** Where to open the map when nothing is pinned yet (e.g. the selected branch). */
  start?: LatLng | null;
  /** Shows "Near: …" under the map with a button that passes the address on. */
  onAddress?: (address: string) => void;
  /** Called automatically with the street address each time the pin settles. */
  onResolvedAddress?: (address: string, parts?: AddressParts) => void;
  /** Move the map here (e.g. a search result). The new centre is also reported as the pin. */
  flyTo?: LatLng | null;
  /** Pixels, or any CSS length such as '100%' to fill the parent. */
  height?: number | string;
  /** No rounded frame, for full-screen layouts. */
  bare?: boolean;
  /** Drawn over the top of the map, e.g. a search box. */
  overlay?: ReactNode;
  footer?: ReactNode;
}) {
  const [jump, setJump] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [near, setNear] = useState('');
  const initial = useRef(value ?? start ?? DEFAULT_CENTER);
  const lookup = useRef(0);
  const wantsAddress = !!onAddress || !!onResolvedAddress;
  const resolved = useRef(onResolvedAddress);
  resolved.current = onResolvedAddress;
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => { if (flyTo) { setJump(flyTo); changed.current(flyTo); } }, [flyTo]);

  // Ask OpenStreetMap what is at the pin, at most once per pause in dragging (Nominatim allows ~1 request/second).
  useEffect(() => {
    if (!value || !wantsAddress) return;
    const id = ++lookup.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { label: address, parts } = await reverseGeocodeDetails(value, controller.signal);
        if (id !== lookup.current || !address) return;
        setNear(address);
        resolved.current?.(address, parts);
      } catch { /* offline or rate-limited: the pin still works without an address */ }
    }, 900);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, wantsAddress]);

  function useMyLocation() {
    if (!navigator.geolocation) { setGeoError('This device cannot share its location.'); return; }
    setLocating(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setJump(p); onChange(p); setLocating(false); },
      (err) => { setGeoError(err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Search or drag the map instead.' : 'Could not get your location. Search or drag the map instead.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }

  return (
    <div className={bare ? 'h-full' : undefined}>
      <div className={`relative isolate overflow-hidden ${bare ? '' : 'rounded-2xl ring-1 ring-slate-200'}`} style={{ height }}>
        <MapContainer center={initial.current} zoom={value ? 17 : 15} className="size-full" scrollWheelZoom attributionControl zoomControl={!bare}>
          <TileLayer url={TILES} attribution={ATTRIBUTION} />
          {bare && <ZoomControl position="topright" />}
          <CenterTracker onMove={onChange} />
          <ResizeFix />
          <Recenter to={jump} />
        </MapContainer>
        {/* Fixed centre pin: the map moves underneath it. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full">
          <MapPin className={`${bare ? 'size-12' : 'size-10'} fill-orange-500 text-white drop-shadow-[0_6px_6px_rgba(0,0,0,.35)]`} strokeWidth={1.5} />
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[499] size-2 -translate-x-1/2 rounded-full bg-black/30 blur-[1px]" />
        {overlay}
        <button
          type="button"
          onClick={useMyLocation}
          className={`absolute z-[500] inline-flex items-center gap-1.5 rounded-full bg-white font-semibold text-slate-700 shadow-md ring-1 ring-slate-200 transition hover:text-emerald-700 ${bare ? 'bottom-6 right-5 h-11 px-4 text-sm' : 'right-3 top-3 h-9 px-3 text-xs'}`}
        >
          {locating ? <LoaderCircle className="size-4 animate-spin" /> : <LocateFixed className="size-4 text-emerald-600" />} Use my location
        </button>
        {!value && <span className={`pointer-events-none absolute z-[500] rounded-xl bg-white/95 px-3 py-2 text-center text-xs font-medium text-slate-600 shadow ring-1 ring-slate-200 ${bare ? 'bottom-6 left-5 hidden sm:block' : 'inset-x-3 bottom-3'}`}><Crosshair className="mr-1 inline size-3.5" />Drag the map so the pin is on your door</span>}
        {geoError && bare && <span className="absolute bottom-20 right-5 z-[500] max-w-xs rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow ring-1 ring-amber-200">{geoError}</span>}
      </div>
      {geoError && !bare && <p className="mt-1.5 text-xs text-amber-700">{geoError}</p>}
      {value && onAddress && near && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-orange-500" />
          <span className="min-w-0 flex-1">Near: {near}</span>
          <button type="button" onClick={() => onAddress(near)} className="shrink-0 font-semibold text-emerald-700 hover:underline">Use</button>
        </p>
      )}
      {footer}
    </div>
  );
}
