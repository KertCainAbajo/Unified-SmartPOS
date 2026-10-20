import { Download, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { isShopApp } from '../../lib/shopApp';

/** The Android app (customer-app/), served by this website. Replace the file and push to publish a new version. */
export const ANDROID_APP_URL = '/downloads/AlingNenaShop.apk';
const DISMISS_KEY = 'shop.app-banner.dismissed';

const isAndroidBrowser = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && !isShopApp();

/** "Get the Android app" bar for shoppers on an Android phone's browser (not inside the app, not on computers or iPhones). */
export function AppDownloadBanner() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  if (hidden || !isAndroidBrowser()) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* not remembered */ }
  };

  return (
    <div role="region" aria-label="Android app" className="flex items-center gap-3 bg-gradient-to-r from-emerald-800 to-emerald-950 px-4 py-2.5 text-white">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-emerald-950"><Smartphone className="size-5" /></span>
      <p className="min-w-0 flex-1 text-xs leading-snug">
        <strong className="block text-sm">Get the Aling Nena Shop app</strong>
        <span className="text-emerald-100/80">Faster ordering on your Android phone. Free.</span>
      </p>
      <a href={ANDROID_APP_URL} download className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-bold text-emerald-900 shadow-sm">
        <Download className="size-3.5" /> Install
      </a>
      <button type="button" onClick={dismiss} aria-label="Hide app banner" className="grid size-8 shrink-0 place-items-center rounded-full text-emerald-100/80 hover:bg-white/10">
        <X className="size-4" />
      </button>
    </div>
  );
}
