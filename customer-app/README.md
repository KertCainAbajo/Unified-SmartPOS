# Aling Nena Shop — customer app (Android + iPhone)

A phone app for **customers only**. It opens the online shop of the Unified SmartPOS server, so it always shows the
live catalogue and stock, and every order lands in the store's **Online orders** like any web order. Inside the app,
staff pages (sign-in, POS, admin) are not reachable: they send the customer back to the shop.

## Test on your Android phone (same Wi-Fi as this computer)

1. On this computer, start the API (`php artisan serve`) and the website for the Wi-Fi: `cd web` → `npm run dev:lan`.
2. Copy `AlingNenaShop-test.apk` to the phone and open it (allow "Install unknown apps" when asked).
3. Open **Aling Nena Shop**. It connects to `http://192.168.1.31:5173` (this computer's Wi-Fi address).

If this computer's Wi-Fi address changes, rebuild with the new one:

```
set SHOP_URL=http://NEW.IP.ADDRESS:5173/shop/aling-nena-mini-mart
npm run apk
```

and add `NEW.IP.ADDRESS:5173` to `SANCTUM_STATEFUL_DOMAINS` in the Laravel `.env`.

## Release

1. Put the system online with **https** (a domain such as `https://shop.alingnena.ph`).
2. `set SHOP_URL=https://shop.alingnena.ph/shop/aling-nena-mini-mart` then `npm run sync`.
3. **Android:** `npm run android` opens Android Studio → *Build → Generate Signed App Bundle* → upload to Google Play.
4. **iPhone:** on a Mac with Xcode: `npm run ios` → set your Apple Developer team → *Product → Archive* → App Store.

Location ("Use my location" on the delivery map) works on https only — on the plain-http test build, pin by dragging
the map or searching instead.

## Files

- `capacitor.config.ts` — app name, id (`ph.alingnena.shop`), shop address, splash and status bar colours.
- `www/offline.html` — the "No connection" screen with a *Try again* button.
- `assets/` — the icon and splash sources (regenerate with `npx capacitor-assets generate`).
- `android/`, `ios/` — the native projects.
