/**
 * The business this browser belongs to. Once someone has opened a business on a device (or a staff member
 * entered the business code once), staff sign in there with only their username or employee ID and password.
 * Every store used on the device is also kept in a short "recent" list, so switching back is one click.
 */
export interface DeviceBusiness {
  code: string;
  name: string;
}

const KEY = 'smartpos.deviceBusiness';
const RECENT_KEY = 'smartpos.recentBusinesses';
const LEGACY_KEY = 'smartpos.businessCode';
const MAX_RECENT = 5;

function parse(value: unknown): DeviceBusiness | null {
  if (!value || typeof value !== 'object') return null;
  const { code, name } = value as Partial<DeviceBusiness>;
  return typeof code === 'string' && code ? { code, name: typeof name === 'string' && name ? name : code } : null;
}

export function getDeviceBusiness(): DeviceBusiness | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return parse(JSON.parse(stored));
    const legacy = localStorage.getItem(LEGACY_KEY);
    return legacy ? { code: legacy, name: legacy } : null;
  } catch {
    return null;
  }
}

/** Stores used on this device, most recent first. */
export function getRecentBusinesses(): DeviceBusiness[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown[];
    return Array.isArray(list) ? list.map(parse).filter((b): b is DeviceBusiness => b !== null) : [];
  } catch {
    return [];
  }
}

export function setDeviceBusiness(business: DeviceBusiness | null): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
    if (!business) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(business));
    // A real name replaces a placeholder (the code) for the same store.
    const recent = [business, ...getRecentBusinesses().filter((b) => b.code !== business.code)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Storage unavailable (private mode): the business code is simply asked for again.
  }
}
