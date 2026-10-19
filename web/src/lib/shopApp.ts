/**
 * The customer phone app (customer-app/, Android + iPhone) opens this website's online shop. It adds
 * "AlingNenaShopApp" to the browser's user agent so the site can keep the app on the customer side only.
 */
export const isShopApp = (): boolean => typeof navigator !== 'undefined' && /AlingNenaShopApp\//.test(navigator.userAgent);

const DEFAULT_SHOP = '/shop/aling-nena-mini-mart';
const LAST_SHOP_KEY = 'shop-app.last-shop';

/** Where the app should be: the shop it last showed, else the default shop. */
export function appHome(): string {
  try { return localStorage.getItem(LAST_SHOP_KEY) || DEFAULT_SHOP; } catch { return DEFAULT_SHOP; }
}

/** Inside the app only `/shop/...` pages are allowed; anything else (staff sign-in, careers…) goes back to the shop. */
export function shopAppPath(pathname: string): string | null {
  if (!isShopApp()) return null;
  if (pathname.startsWith('/shop/')) {
    try { localStorage.setItem(LAST_SHOP_KEY, pathname.split('/').slice(0, 3).join('/')); } catch { /* not remembered */ }
    return null;
  }
  return appHome();
}
