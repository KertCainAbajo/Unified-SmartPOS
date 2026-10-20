import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * A brand-new business with nothing in it yet (like the real store after a fresh start): register, open every
 * page while empty, add the first product, and check the empty shop and the customer app. e2e database only.
 */
const STAMP = Date.now();
const OWNER = { name: 'Fresh Owner', email: `fresh.owner.${STAMP}@example.com`, password: 'FreshPass123' };
const BUSINESS = `Fresh Mart ${STAMP}`;
let tenantPath = '';
let shopPath = '';

function watch(page: Page, problems: string[], where: { at: string }) {
  page.on('pageerror', (e) => problems.push(`[${where.at}] Page error: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) problems.push(`[${where.at}] HTTP ${r.status()} ${r.url()}`);
  });
}

test.describe.serial('a brand-new empty business', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('registers and lands on an empty dashboard', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Your name').fill(OWNER.name);
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByLabel('Confirm password').fill(OWNER.password);
    await page.getByLabel('Business name').fill(BUSINESS);
    await page.getByLabel('First branch name').fill('Main Branch');
    await page.getByRole('button', { name: /create|register|sign up/i }).last().click();
    await expect(page).toHaveURL(/\/t\/\d+$/, { timeout: 20_000 });
    tenantPath = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  });

  test('every page opens with no data and no errors', async ({ page }) => {
    test.setTimeout(180_000);
    const problems: string[] = [];
    const where = { at: 'sign in' };
    watch(page, problems, where);
    await page.goto('/login');
    await page.getByRole('radio', { name: /Management/ }).click();
    await page.getByLabel('Work email').fill(OWNER.email);
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByRole('button', { name: /Sign in/ }).click();
    await expect(page).toHaveURL(new RegExp(`${tenantPath}$`));

    const links = await page.getByRole('navigation', { name: 'Main' }).locator(`a[href^="${tenantPath}"]`)
      .evaluateAll((els) => [...new Set(els.map((a) => a.getAttribute('href')!))]);
    expect(links.length).toBeGreaterThan(10);
    for (const href of links) {
      where.at = href;
      await page.goto(href);
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      for (const text of await page.locator('main [role="alert"]').allInnerTexts()) problems.push(`[${href}] Error on screen: ${text.replace(/\s+/g, ' ')}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the empty shop says so, then shows the first product once it is added', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('radio', { name: /Management/ }).click();
    await page.getByLabel('Work email').fill(OWNER.email);
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByRole('button', { name: /Sign in/ }).click();
    await expect(page).toHaveURL(new RegExp(`${tenantPath}$`));

    const id = tenantPath.split('/').pop();
    const slug = await page.evaluate(async (id) => (await (await fetch(`/api/v1/tenants/${id}`, { credentials: 'include', headers: { Accept: 'application/json' } })).json()).data.slug, id);
    shopPath = `/shop/${slug}`;
    await page.goto(shopPath);
    await expect(page.getByText('No products yet')).toBeVisible();

    await page.goto(`${tenantPath}/products`);
    await page.getByRole('button', { name: 'Add product' }).first().click();
    await page.getByLabel('Name').fill('First Product 1L');
    await page.getByLabel(/^SKU/).fill(`FIRST-${STAMP}`);
    await page.getByLabel(/Selling price|^Price/).first().fill('25');
    await page.getByRole('dialog').getByRole('button', { name: 'Add product' }).click();
    await expect(page.getByText('First Product 1L').first()).toBeVisible();

    await page.goto(shopPath);
    await expect(page.getByText('First Product 1L').first()).toBeVisible();
    await expect(page.getByText(/Out of stock/).first()).toBeVisible();
  });

  test.describe('in the customer app', () => {
    const phone = devices['Pixel 7'];
    test.use({ viewport: phone.viewport, isMobile: true, hasTouch: true, userAgent: `${phone.userAgent} AlingNenaShopApp/1.0` });

    test('the new shop opens on a phone and a customer can sign up', async ({ page }) => {
      const problems: string[] = [];
      watch(page, problems, { at: 'app' });
      await page.goto(shopPath);
      await expect(page.getByText('First Product 1L').first()).toBeVisible();
      await page.getByRole('button', { name: /sign in/i }).first().click();
      await page.getByRole('radio', { name: /create account/i }).click();
      await page.locator('input[name=name]').fill('First Customer');
      await page.locator('input[name=phone]').fill('09170000001');
      await page.locator('input[name=email]').fill(`fresh.customer.${STAMP}@example.com`);
      await page.locator('input[name=password]').fill('customer-pass-1');
      await page.locator('input[name=password_confirmation]').fill('customer-pass-1');
      await page.locator('input[name=accept_terms]').check();
      await page.locator('form button[type=submit]').click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
});
