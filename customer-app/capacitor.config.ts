import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Aling Nena Mini Mart customer app (Android + iPhone).
 *
 * The app opens the online shop of the Unified SmartPOS server, so it always has the live catalogue, stock, orders
 * and rider tracking, and every order lands in the store's Online orders like any web order.
 *
 * SHOP_URL decides which server the app opens (set it before `npm run sync` / `npm run apk`):
 *  - testing on the same Wi-Fi:  http://<this computer's IP>:5173/shop/aling-nena-mini-mart
 *  - release:                    https://<your domain>/shop/aling-nena-mini-mart
 */
const SHOP_URL = process.env.SHOP_URL ?? 'http://192.168.1.31:5173/shop/aling-nena-mini-mart';
const host = new URL(SHOP_URL).host;
// The offline page needs the address to retry; written next to it whenever the app is synced or built.
writeFileSync(join(__dirname, 'www', 'shop-url.js'), `window.SHOP_URL = ${JSON.stringify(SHOP_URL)};
`);

const config: CapacitorConfig = {
  appId: 'ph.alingnena.shop',
  appName: 'Aling Nena Shop',
  // Bundled pages: the start screen and the "no connection" screen.
  webDir: 'www',
  server: {
    url: SHOP_URL,
    // Plain http is only for testing on the local Wi-Fi; a release uses https.
    cleartext: SHOP_URL.startsWith('http://'),
    // Only the shop's own server opens inside the app; other links open in the phone's browser.
    allowNavigation: [host],
    // Shown when the server cannot be reached (no internet, server off).
    errorPath: 'offline.html',
  },
  // Lets the shop know it is running inside the app (it then hides everything that is not the customer shop).
  appendUserAgent: 'AlingNenaShopApp/1.0',
  backgroundColor: '#fbf7ec',
  android: {
    allowMixedContent: SHOP_URL.startsWith('http://'),
  },
  ios: {
    contentInset: 'automatic',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#fbf7ec',
      showSpinner: false,
      androidScaleType: 'CENTER_INSIDE',
    },
    StatusBar: {
      backgroundColor: '#ffffff',
      style: 'LIGHT',
      overlaysWebView: false,
    },
  },
};

export default config;
