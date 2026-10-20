import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, TENANT } from './fixtures';

/**
 * Whole processes across people: a new shopper signs up (email code), orders for pickup, the store confirms and
 * prepares it, and the owner rings it up on the cashier's open register until the order is completed.
 * Runs on the throwaway e2e database only.
 */
const SHOP = '/shop/aling-nena-mini-mart';
const EMAIL = `e2e.shopper.${Date.now()}@example.com`;
const PASSWORD = 'shopper-password-1';
let orderNumber = '';

/** The emailed code is covered by the backend tests; here the account is confirmed directly in the e2e database. */
function confirmEmail(email: string) {
  execFileSync('php', ['artisan', 'tinker', '--env=e2e', `--execute=App\\Models\\CustomerAccount::where('email','${email}')->update(['status'=>'active','email_verified_at'=>now()]);`], { cwd: join(process.cwd(), '..') });
}

test.describe.serial('online pickup order, end to end', () => {
  test.describe('shopper', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('signs up and is asked for the emailed code', async ({ page }) => {
      await page.goto(SHOP);
      await page.getByRole('button', { name: /sign in/i }).first().click();
      await page.getByRole('radio', { name: /create account/i }).click();
      await page.locator('input[name=name]').fill('E2E Shopper');
      await page.locator('input[name=phone]').fill('09170000000');
      await page.locator('input[name=email]').fill(EMAIL);
      await page.locator('input[name=password]').fill(PASSWORD);
      await page.locator('input[name=password_confirmation]').fill(PASSWORD);
      await page.locator('input[name=accept_terms]').check();
      await page.locator('form button[type=submit]').click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    });

    test('signs in after confirming and places a pickup order', async ({ page }) => {
      confirmEmail(EMAIL);
      await page.goto(SHOP);
      await page.getByRole('button', { name: /sign in/i }).first().click();
      await page.locator('input[name=email]').fill(EMAIL);
      await page.locator('input[name=password]').fill(PASSWORD);
      await page.locator('form button[type=submit]').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.getByRole('button', { name: /^Add / }).first().click();
      await page.getByRole('radio', { name: /Main Branch - Quezon City/ }).first().check({ force: true });
      await page.getByRole('button', { name: /Place pickup order/ }).click();
      const placed = page.getByText(/ORD-[A-Z]+-\d{6}/).first();
      await expect(placed).toBeVisible();
      orderNumber = (await placed.innerText()).match(/ORD-[A-Z]+-\d{6}/)![0];
    });
  });

  test('the store confirms, prepares and rings up the order', async ({ page }) => {
    expect(orderNumber, 'the shopper placed an order').not.toBe('');
    await page.goto(`${TENANT}/online-orders`);
    const card = page.locator('article', { hasText: orderNumber });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Confirm order' }).click();
    await card.getByRole('button', { name: 'Ready for pickup' }).click();
    await card.getByRole('button', { name: /Customer is here/ }).click();

    // The owner has no shift of their own: they record the payment on the cashier's open register.
    await expect(page).toHaveURL(/\/pos\?online_order_id=/);
    await page.getByRole('button', { name: 'Use this register' }).first().click();
    await expect(page.getByText(`Checking out online order ${orderNumber}`)).toBeVisible();
    await page.getByRole('button', { name: /Charge ₱/ }).click();
    const payment = page.getByRole('dialog', { name: 'Payment' });
    await payment.getByLabel('How much did the customer give?').fill('1000');
    await payment.getByRole('button', { name: /Complete sale/ }).click();
    await expect(page.getByRole('dialog', { name: 'Sale complete' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Sale complete' }).getByRole('button', { name: 'New sale' }).click();
    await page.getByRole('button', { name: 'Leave register' }).click();

    await page.goto(`${TENANT}/online-orders`);
    await page.getByRole('tab', { name: 'completed' }).click();
    await expect(page.getByText(orderNumber).first()).toBeVisible();
  });
});

/**
 * Delivery with a staff rider: the shopper orders for delivery (paying ₱1,000 cash), the store sends it out with the
 * demo rider, the rider marks it delivered on their screen, and the store records the cash at the POS.
 */
test.describe.serial('delivery with a rider, end to end', () => {
  let deliveryNumber = '';

  test.describe('shopper', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('orders for delivery', async ({ page }) => {
      await page.goto(SHOP);
      deliveryNumber = await page.evaluate(async ({ email, password }) => {
        await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
        const xsrf = () => decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))!.split('=')[1]);
        const post = (url: string, body: unknown) => fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf() }, body: JSON.stringify(body) });
        const base = '/api/v1/shop/aling-nena-mini-mart';
        await post(`${base}/login`, { email, password });
        const shop = await (await fetch(base, { credentials: 'include', headers: { Accept: 'application/json' } })).json();
        const branch = shop.branches.find((b: { name: string }) => b.name.startsWith('Main'));
        const product = shop.data.find((p: { name: string }) => p.name.startsWith('Coca-Cola'));
        const res = await post(`${base}/orders`, {
          branch_id: branch.id, fulfilment: 'delivery', delivery_address: 'Blk 4 Lot 12, Mahogany St., Quezon City',
          cash_amount: '1000', contact_name: 'E2E Shopper', contact_phone: '09170000000', items: [{ product_id: product.id, quantity: 1 }],
        });
        return (await res.json()).data?.order_number ?? '';
      }, { email: EMAIL, password: PASSWORD });
      expect(deliveryNumber).toMatch(/ORD-/);
    });
  });

  test('the store prepares it and sends it out with the rider', async ({ page }) => {
    await page.goto(`${TENANT}/online-orders`);
    const card = page.locator('article', { hasText: deliveryNumber });
    await card.getByRole('button', { name: 'Confirm order' }).click();
    await card.getByRole('button', { name: 'Packed, ready to send' }).click();
    await card.getByRole('button', { name: 'Send out for delivery' }).click();
    const send = page.getByRole('dialog', { name: 'Send out for delivery' });
    await send.getByText('Ben Santos').first().click();
    await send.getByRole('button', { name: 'Send out' }).click();
    await expect(card.getByText(/Ben Santos/).first()).toBeVisible();
  });

  test.describe('rider', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('marks it delivered and cash collected', async ({ page }) => {
      await page.goto('/login');
      await page.evaluate(async () => {
        await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
        const xsrf = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))!.split('=')[1]);
        await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf }, body: JSON.stringify({ business_code: 'aling-nena-mini-mart', username: 'rider.all01', password: 'DemoPass123' }) });
      });
      await page.goto(`${TENANT}/deliveries`);
      await expect(page.getByText(deliveryNumber).first()).toBeVisible();
      await page.getByRole('button', { name: /Delivered & cash collected/ }).first().click();
      await page.getByRole('button', { name: 'Yes, delivered' }).click();
      await expect(page.getByText(/Hand in at the store|Give this cash/).first()).toBeVisible();
    });
  });

  test('the store records the cash and the order is completed', async ({ page }) => {
    await page.goto(`${TENANT}/online-orders`);
    const card = page.locator('article', { hasText: deliveryNumber });
    await card.getByRole('button', { name: 'Record payment' }).click();
    await page.getByRole('button', { name: 'Use this register' }).first().click();
    await expect(page.getByText(`Checking out online order ${deliveryNumber}`)).toBeVisible();
    await page.getByRole('button', { name: /Charge ₱/ }).click();
    const payment = page.getByRole('dialog', { name: 'Payment' });
    await payment.getByLabel('How much did the customer give?').fill('1000');
    await payment.getByRole('button', { name: /Complete sale/ }).click();
    await expect(page.getByRole('dialog', { name: 'Sale complete' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Sale complete' }).getByRole('button', { name: 'New sale' }).click();
    await page.getByRole('button', { name: 'Leave register' }).click();

    await page.goto(`${TENANT}/online-orders`);
    await page.getByRole('tab', { name: 'completed' }).click();
    await expect(page.getByText(deliveryNumber).first()).toBeVisible();
  });
});
