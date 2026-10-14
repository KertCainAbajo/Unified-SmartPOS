/**
 * The business this browser belongs to. Once someone has opened a business on a device (or a staff member
 * entered the business code once), staff sign in there with only their username or employee ID and password.
 */
export interface DeviceBusiness {
  code: string;
  name: string;
}

const KEY = 'smartpos.deviceBusiness';
const LEGACY_KEY = 'smartpos.businessCode';

export function getDeviceBusiness(): DeviceBusiness | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DeviceBusiness>;
      if (typeof parsed.code === 'string' && parsed.code) return { code: parsed.code, name: parsed.name || parsed.code };
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    return legacy ? { code: legacy, name: legacy } : null;
  } catch {
    return null;
  }
}

export function setDeviceBusiness(business: DeviceBusiness | null): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
    if (business) localStorage.setItem(KEY, JSON.stringify(business));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode): the business code is simply asked for again.
  }
}
