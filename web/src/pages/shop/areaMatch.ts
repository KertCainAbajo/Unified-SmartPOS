import type { QueryClient } from '@tanstack/react-query';
import type { AddressParts } from '../../components/maps';
import { api } from '../../lib/api';
import type { Area, AreaPath } from './AreaPicker';

/** Names compared loosely: "City of Davao" = "Davao City", "Barangay 20-B (Pob.)" = "Barangay 20-B", "Sto." = "Santo". */
function norm(name: string): string {
  return name.toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(city of|municipality of|city|municipality|barangay|brgy\.?|poblacion|pob\.?|district|region|province of)\b/g, ' ')
    .replace(/\bsto\.?(?=\s|$)/g, 'santo').replace(/\bsta\.?(?=\s|$)/g, 'santa').replace(/\bstn\.?(?=\s|$)/g, 'santo nino')
    .replace(/\bkap\.?(?=\s|$)/g, 'kapitan').replace(/\bgen\.?(?=\s|$)/g, 'general').replace(/\bpres\.?(?=\s|$)/g, 'presidente')
    .replace(/\bdr\.?(?=\s|$)/g, 'doctor').replace(/\bmt\.?(?=\s|$)/g, 'mount').replace(/\bsr\.?(?=\s|$)/g, 'senior').replace(/\bsenior\b/g, 'sr')
    .replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, ' ').trim();
}

function find(areas: Area[], names: (string | undefined)[]): Area | null {
  for (const name of names) {
    if (!name) continue;
    const n = norm(name);
    if (!n) continue;
    const hit = areas.find((a) => norm(a.name) === n || norm(a.hint ?? '') === n)
      ?? areas.find((a) => { const m = norm(a.name); return m.length > 2 && (m.startsWith(`${n} `) || n.startsWith(`${m} `)); });
    if (hit) return hit;
  }
  return null;
}

/**
 * Turns what the map knows about the pinned spot into Region → Province → City → Barangay from the official PSGC
 * lists (the same lists as the dropdown). Fills as many levels as it can match; anything not found stays empty for
 * the customer to choose. Lists are cached, so dragging the pin around costs few requests.
 */
export async function matchArea(parts: AddressParts, queryClient: QueryClient): Promise<{ area: AreaPath; postal: string | null } | null> {
  const load = (type: string, parent?: string) => queryClient.fetchQuery({
    queryKey: ['ph-areas', type.replace(/s$/, '').replace('citie', 'city'), parent ?? ''],
    queryFn: () => api<{ data: Area[] }>('/address/areas', { query: { type, parent } }),
    staleTime: 24 * 60 * 60 * 1000,
  }).then((r) => r.data);

  const regions = await load('regions');
  const region = find(regions, [parts.region, parts.region === 'Metro Manila' ? 'Metro Manila' : undefined, parts.province, parts.city === 'Manila' ? 'Metro Manila' : undefined]);
  if (!region) return null;

  const provinces = await load('provinces', region.code);
  let province = find(provinces, [parts.province]);
  let city: Area | null = null;
  if (province) {
    city = find(await load('cities', province.code), [parts.city]);
  } else {
    // The map often skips the province (e.g. independent cities): find the province whose city list has this city.
    for (const candidate of provinces) {
      city = find(await load('cities', candidate.code), [parts.city]);
      if (city) { province = candidate; break; }
    }
  }
  if (!province) return { area: { region, province: null, city: null, barangay: null }, postal: parts.postcode ?? null };
  if (!city) return { area: { region, province, city: null, barangay: null }, postal: parts.postcode ?? null };

  const barangay = find(await load('barangays', city.code), parts.barangays);
  return { area: { region, province, city, barangay }, postal: parts.postcode ?? null };
}
