import { test as base, expect, type Page } from '@playwright/test';

export const OWNER = { email: 'owner@demo.smartpos.test', password: 'DemoPass123' };
export const TENANT = '/t/1';

/**
 * Every test fails if the page logs a JavaScript error or the API answers with a server error (5xx),
 * even when the screen itself looks fine.
 */
export const test = base.extend<{ watchErrors: void }>({
  watchErrors: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (err) => problems.push(`Page error: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(msg.text())) {
          problems.push(`Console error: ${msg.text()}`);
        }
      });
      page.on('response', (res) => {
        if (res.status() >= 500) problems.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
      });
      await use();
      expect(problems, problems.join('\n')).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Opens a page inside the business and waits for its title. */
export async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(`${TENANT}${path}`);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

/** Signs in through the real login form as management (email + password). */
export async function signIn(page: Page, email = OWNER.email, password = OWNER.password) {
  await page.goto('/login');
  await page.getByRole('radio', { name: /Management/ }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Sign in/ }).click();
}
