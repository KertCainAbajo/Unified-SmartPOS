import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every role: sign in, open every menu item that role can see, and collect anything wrong on the way —
 * JavaScript errors, server errors (5xx), "forbidden" answers (403) from pages the role was allowed to open,
 * and error banners on screen. Read-only: nothing is created or changed.
 */
type Account = { role: string; email?: string; username?: string };
const PASSWORD = 'DemoPass123';
const BUSINESS = 'aling-nena-mini-mart';

const ACCOUNTS: Account[] = [
  { role: 'Owner', email: 'owner@demo.smartpos.test' },
  { role: 'Branch manager', email: 'manager@demo.smartpos.test' },
  { role: 'HR / access manager', email: 'hr@demo.smartpos.test' },
  { role: 'Cashier (email)', email: 'cashier@demo.smartpos.test' },
  { role: 'Inventory staff', email: 'inventory@demo.smartpos.test' },
  { role: 'Cashier (username)', username: 'cashier.main01' },
  { role: 'Accountant', username: 'accountant.all01' },
  { role: 'Delivery rider', username: 'rider.all01' },
];

const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

async function signInByApi(page: Page, account: Account) {
  await page.goto('/login');
  const status = await page.evaluate(async ({ account, password, business }) => {
    await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
    const xsrf = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))!.split('=')[1]);
    const body = account.email ? { email: account.email, password } : { business_code: business, username: account.username, password };
    const r = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf }, body: JSON.stringify(body) });
    return r.status;
  }, { account, password: PASSWORD, business: BUSINESS });
  expect(status, `${account.role} can sign in`).toBe(200);
}

function watch(page: Page, problems: string[], where: { current: string }) {
  page.on('pageerror', (err) => problems.push(`[${where.current}] Page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|the server responded with a status of 4\d\d/.test(msg.text())) problems.push(`[${where.current}] Console error: ${msg.text()}`);
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    if (res.status() >= 500) problems.push(`[${where.current}] HTTP ${res.status()} ${res.request().method()} ${url}`);
    if (res.status() === 403) problems.push(`[${where.current}] Forbidden ${res.request().method()} ${url}`);
  });
}

for (const account of ACCOUNTS) {
  test(`${account.role}: every menu page works`, async ({ page }) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    const where = { current: 'sign in' };
    watch(page, problems, where);
    await signInByApi(page, account);

    await page.goto('/t/1');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    const links = await nav.locator('a[href^="/t/1"]').evaluateAll((els) => [...new Set(els.map((a) => a.getAttribute('href')!))]);
    expect(links.length, 'the menu has pages').toBeGreaterThan(0);

    for (const href of links) {
      where.current = href;
      await page.goto(href);
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      const alerts = await page.locator('main [role="alert"]').allInnerTexts();
      for (const text of alerts) problems.push(`[${href}] Error on screen: ${text.replace(/\s+/g, ' ').trim()}`);
    }
    expect(problems, `${account.role}:\n${problems.join('\n')}`).toEqual([]);
  });
}

test('Guest shopper: shop, basket and sign-in window work', async ({ page }) => {
  const problems: string[] = [];
  const where = { current: '/shop' };
  watch(page, problems, where);
  await page.goto('/shop');
  await page.goto(`/shop/${BUSINESS}`);
  await expect(page.getByRole('heading', { name: /All products/i })).toBeVisible();
  await page.getByRole('button', { name: /^Add / }).first().click();
  await page.getByRole('button', { name: 'delivery', exact: true }).first().click();
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Platform admin: every console tab works', async ({ page }) => {
  const problems: string[] = [];
  const where = { current: '/platform' };
  watch(page, problems, where);
  await signInByApi(page, { role: 'Platform admin', email: 'admin@demo.smartpos.test' });
  await page.goto('/platform');
  for (const tab of ['Overview', 'Businesses', 'Accounts & admins', 'Activity log']) {
    where.current = `/platform › ${tab}`;
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    for (const text of await page.locator('main [role="alert"]').allInnerTexts()) problems.push(`[${tab}] Error on screen: ${text}`);
  }
  await page.getByRole('button', { name: 'Businesses', exact: true }).click();
  await page.getByRole('button', { name: /View details/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});
