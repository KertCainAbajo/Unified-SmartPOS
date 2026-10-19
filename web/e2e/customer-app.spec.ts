import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { devices, type Page } from '@playwright/test';
import { expect, test, TENANT } from './fixtures';

/**
 * The customer side as the phone app uses it (phone screen, app mode), and every hand-over to the staff:
 * sign-up with the email code, browsing, basket, account, cancelling, pickup and delivery orders through the store
 * and the rider, tracking, history and forgot-password. Runs on the throwaway e2e database only.
 */
const SHOP = '/shop/aling-nena-mini-mart';
const API = '/api/v1/shop/aling-nena-mini-mart';
const EMAIL = `e2e.app.${Date.now()}@example.com`;
const PASSWORD = 'app-password-1';
const NEW_PASSWORD = 'app-password-2';
const phone = devices['Pixel 7'];
const appContext = {
  viewport: phone.viewport, deviceScaleFactor: phone.deviceScaleFactor, isMobile: true, hasTouch: true,
  userAgent: `${phone.userAgent} AlingNenaShopApp/1.0`, storageState: { cookies: [], origins: [] },
};

function tinker(php: string) {
  return execFileSync('php', ['artisan', 'tinker', '--env=e2e', `--execute=${php}`], { cwd: join(process.cwd(), '..') }).toString();
}

/** Signs the customer in through the shop API (the sign-in screen itself is tested once below). */
async function signIn(page: Page, password = PASSWORD) {
  await page.goto(SHOP);
  const status = await page.evaluate(async ({ api, email, password }) => {
    await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
    const xsrf = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))!.split('=')[1]);
    const r = await fetch(`${api}/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf }, body: JSON.stringify({ email, password, remember: true }) });
    return r.status;
  }, { api: API, email: EMAIL, password });
  expect(status, 'customer signs in').toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: 'My account' })).toBeVisible();
}

async function placeOrder(page: Page, kind: 'pickup' | 'delivery', branch = /Main Branch - Quezon City/) {
  await page.getByRole('button', { name: /^Add Coca-Cola/ }).first().click();
  if (kind === 'delivery') await page.getByRole('button', { name: 'delivery', exact: true }).click();
  await page.getByRole('radio', { name: branch }).first().check({ force: true });
  if (kind === 'delivery') await page.getByLabel('Cash amount in Philippine pesos').fill('1000');
  const reply = page.waitForResponse((r) => r.url().endsWith(`${API}/orders`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: new RegExp(`Place ${kind} order`) }).click();
  const number = (await (await reply).json()).data.order_number as string;
  // The shop confirms the new order on screen.
  await expect(page.getByText(number).first()).toBeVisible();
  return number;
}

test.describe.serial('customer app, end to end', () => {
  let pickup = '';
  let delivery = '';

  test.describe('in the app', () => {
    test.use(appContext);

    test('the app stays on the shop: staff pages send the customer back', async ({ page }) => {
      await page.goto('/login');
      await expect(page).toHaveURL(new RegExp(`${SHOP}$`));
      await page.goto(`${TENANT}/pos`);
      await expect(page).toHaveURL(new RegExp(`${SHOP}$`));
      await expect(page.getByRole('heading', { name: /All products/ })).toBeVisible();
    });

    test('a guest browses: categories slide, search, save and basket', async ({ page }) => {
      await page.goto(SHOP);
      const more = page.getByRole('button', { name: 'More categories' });
      await expect(more).toBeVisible();
      await more.click();
      await page.getByRole('button', { name: /^Beverages/ }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Beverages' })).toBeVisible();
      await page.getByRole('button', { name: /^All products/ }).click();

      await page.getByRole('textbox', { name: 'Search products' }).last().fill('soap');
      await expect(page.getByText('Bath Soap 90g').first()).toBeVisible();
      await expect(page.getByText('Coca-Cola 1L')).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Search products' }).last().fill('');

      await page.getByRole('button', { name: 'Save Bath Soap 90g' }).click();
      await expect(page.getByRole('button', { name: /^Saved/ })).toBeVisible();

      await page.getByRole('button', { name: /^Add Coca-Cola/ }).first().click();
      await page.getByRole('button', { name: /^Add one Coca-Cola/ }).first().click();
      await expect(page.getByText('2 in basket').first()).toBeVisible();
    });

    test('signs up and gets the email code step', async ({ page }) => {
      await page.goto(SHOP);
      await page.getByRole('button', { name: /sign in/i }).first().click();
      await page.getByRole('radio', { name: /create account/i }).click();
      await page.locator('input[name=name]').fill('App Shopper');
      await page.locator('input[name=phone]').fill('09171112222');
      await page.locator('input[name=email]').fill(EMAIL);
      await page.locator('input[name=password]').fill(PASSWORD);
      await page.locator('input[name=password_confirmation]').fill(PASSWORD);
      await page.locator('form button[type=submit]').click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

      // A wrong code is refused with the number of tries left.
      for (let i = 0; i < 6; i++) await page.locator(`#reset-code-${i}`).fill('9');
      await expect(page.getByText(/not right|invalid|expired/i).first()).toBeVisible();
    });

    test('after confirming, signs in on the sign-in screen and edits the account', async ({ page }) => {
      tinker(`App\\Models\\CustomerAccount::where('email','${EMAIL}')->update(['status'=>'active','email_verified_at'=>now()]);`);
      await page.goto(SHOP);
      await page.getByRole('button', { name: /sign in/i }).first().click();
      await page.locator('input[name=email]').fill(EMAIL);
      await page.locator('input[name=password]').fill(PASSWORD);
      await page.locator('form button[type=submit]').click();
      await expect(page.getByRole('button', { name: 'My account' })).toBeVisible();

      await page.getByRole('button', { name: 'My account' }).click();
      const account = page.getByRole('dialog', { name: 'My account' });
      await account.getByLabel('Mobile number').fill('09179998888');
      await account.getByRole('button', { name: 'Save details' }).click();
      await expect(account.getByText('Details saved.')).toBeVisible();
      // On a phone, signing out is in the account window (the header has no room for it).
      await expect(page.locator('header button[aria-label="Sign out"]')).toBeHidden();
      await account.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible();
    });

    test('places a pickup order and cancels it', async ({ page }) => {
      await signIn(page);
      const number = await placeOrder(page, 'pickup');
      await page.getByRole('button', { name: 'Cancel order' }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
      await expect(page.getByText(/cancelled/i).first()).toBeVisible();
      expect(number).toMatch(/ORD-/);
    });

    test('places a pickup order for the store', async ({ page }) => {
      await signIn(page);
      pickup = await placeOrder(page, 'pickup');
    });

    test('opens the delivery address map, then orders for delivery', async ({ page }) => {
      await signIn(page);
      await page.getByRole('button', { name: 'delivery', exact: true }).click();
      await page.getByText('Set delivery address').first().click();
      const address = page.getByRole('dialog', { name: 'Delivery address' });
      await expect(address.getByRole('heading', { name: 'Where should we deliver?' })).toBeVisible();
      await expect(address.locator('.leaflet-container')).toBeVisible();
      await address.getByRole('button', { name: 'Back to basket' }).first().click();

      // The address form needs the live Philippine address list; the saved address is set directly instead.
      const id = await page.evaluate(async (api) => (await (await fetch(`${api}/me`, { credentials: 'include', headers: { Accept: 'application/json' } })).json()).data.id, API);
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [`shop-delivery:aling-nena-mini-mart:${id}`, JSON.stringify({
        region: { code: '1300000000', name: 'NCR' }, province: { code: 'NCR', name: 'Metro Manila' }, city: { code: '1374000000', name: 'Quezon City' },
        barangay: { code: '1374000001', name: 'Bagumbayan' }, street: 'Blk 4 Lot 12, Mahogany St.', postal: '1110', note: 'Green gate', pin: { lat: 14.62, lng: 121.05 },
      })]);
      await page.reload();
      delivery = await placeOrder(page, 'delivery');
    });
  });

  test('the store confirms the pickup order and gets the delivery out with the rider', async ({ page }) => {
    await page.goto(`${TENANT}/online-orders`);
    const p = page.locator('article', { hasText: pickup });
    await p.getByRole('button', { name: 'Confirm order' }).click();
    await p.getByRole('button', { name: 'Ready for pickup' }).click();
    await expect(p.getByRole('button', { name: /Customer is here/ })).toBeVisible();

    const d = page.locator('article', { hasText: delivery });
    await d.getByRole('button', { name: 'Confirm order' }).click();
    await d.getByRole('button', { name: 'Packed, ready to send' }).click();
    await d.getByRole('button', { name: 'Send out for delivery' }).click();
    const send = page.getByRole('dialog', { name: 'Send out for delivery' });
    await send.getByText('Ben Santos').first().click();
    await send.getByRole('button', { name: 'Send out' }).click();
    await expect(d.getByText(/Ben Santos/).first()).toBeVisible();
  });

  test.describe('in the app again', () => {
    test.use(appContext);

    test('the customer sees "ready" and tracks the rider on the way', async ({ page }) => {
      await signIn(page);
      await expect(page.getByText(pickup).first()).toBeVisible();
      await page.getByRole('button', { name: 'My orders' }).click();
      const history = page.getByRole('dialog').last();
      await expect(history.getByText(delivery).first()).toBeVisible();
      await history.getByRole('button', { name: /Track/ }).first().click();
      await expect(page.getByText(/on the way|Ben Santos/i).first()).toBeVisible();
    });
  });

  test.describe('rider', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('delivers and collects the cash', async ({ page }) => {
      await page.goto('/login');
      await page.evaluate(async () => {
        await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
        const xsrf = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))!.split('=')[1]);
        await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf }, body: JSON.stringify({ business_code: 'aling-nena-mini-mart', username: 'rider.all01', password: 'DemoPass123' }) });
      });
      await page.goto(`${TENANT}/deliveries`);
      const card = page.locator('article, li, section', { hasText: delivery }).first();
      await expect(card).toBeVisible();
      await page.getByRole('button', { name: /Delivered & cash collected/ }).first().click();
      await page.getByRole('button', { name: 'Yes, delivered' }).click();
      await expect(page.getByText(/Hand in at the store|Give this cash/).first()).toBeVisible();
    });
  });

  test('the store records both payments and the orders are completed', async ({ page }) => {
    for (const [number, button] of [[pickup, /Customer is here/], [delivery, /Record payment/]] as const) {
      await page.goto(`${TENANT}/online-orders`);
      await page.locator('article', { hasText: number }).getByRole('button', { name: button }).click();
      await page.getByRole('button', { name: 'Use this register' }).first().click();
      await expect(page.getByText(`Checking out online order ${number}`)).toBeVisible();
      await page.getByRole('button', { name: /Charge ₱/ }).click();
      const pay = page.getByRole('dialog', { name: 'Payment' });
      await pay.getByLabel('How much did the customer give?').fill('1000');
      await pay.getByRole('button', { name: /Complete sale/ }).click();
      await page.getByRole('dialog', { name: 'Sale complete' }).getByRole('button', { name: 'New sale' }).click();
      await page.getByRole('button', { name: 'Leave register' }).click();
    }
    await page.goto(`${TENANT}/online-orders`);
    await page.getByRole('tab', { name: 'completed' }).click();
    await expect(page.getByText(pickup).first()).toBeVisible();
    await expect(page.getByText(delivery).first()).toBeVisible();
    await page.goto(`${TENANT}/sales`);
    await expect(page.getByText(/Delivery/).first()).toBeVisible();
  });

  test.describe('in the app at the end', () => {
    test.use(appContext);

    test('the customer sees both orders completed in their history', async ({ page }) => {
      await signIn(page);
      await page.getByRole('button', { name: 'My orders' }).click();
      const history = page.getByRole('dialog').last();
      await history.getByRole('tab', { name: /Past orders/ }).click();
      await expect(history.getByText(pickup).first()).toBeVisible();
      await expect(history.getByText(delivery).first()).toBeVisible();
    });

    test('forgot password: emailed code, new password, sign in with it', async ({ page }) => {
      await page.goto(SHOP);
      await page.getByRole('button', { name: /sign in/i }).first().click();
      await page.getByRole('button', { name: /Forgot password/ }).click();
      await page.locator('#reset-email').fill(EMAIL);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      // The emailed code is replaced by a known one (the e2e server keeps mail in memory).
      tinker(`$a=App\\Models\\CustomerAccount::where('email','${EMAIL}')->first(); $a->passwordCodes()->where('purpose','reset')->whereNull('used_at')->update(['code_hash'=>Hash::make('123456')]);`);
      for (let i = 0; i < 6; i++) await page.locator(`#reset-code-${i}`).fill(String(i + 1));
      await page.getByRole('button', { name: 'Verify code' }).click();
      await page.locator('#reset-password').fill(NEW_PASSWORD);
      await page.locator('#reset-password2').fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Save new password' }).click();
      await expect(page.getByText(/password was changed/i)).toBeVisible();
      await signIn(page, NEW_PASSWORD);
    });
  });
});
