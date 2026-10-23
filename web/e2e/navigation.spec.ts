import { expect, open, signIn, test } from './fixtures';

/** Every section in the sidebar opens, shows its title and loads without errors. */
const PAGES: [string, string, RegExp][] = [
  ['Dashboard', '', /Good (morning|afternoon|evening)/],
  ['Sales', '/sales', /^Sales$/],
  ['Refunds', '/refunds', /^Refunds$/],
  ['Shifts', '/shifts', /^Shifts$/],
  ['Customers', '/customers', /^Customers$/],
  ['Products', '/products', /^Products$/],
  ['Categories', '/categories', /^Categories$/],
  ['Inventory', '/inventory', /^Inventory$/],
  ['Transfers', '/transfers', /^Stock transfers$/],
  ['Purchasing', '/purchasing', /^Purchasing$/],
  ['Expenses', '/expenses', /^Expenses$/],
  ['Reports', '/reports', /^Reports$/],
  ['Audit log', '/audit', /^Audit log$/],
  ['Recruitment', '/recruitment', /^Recruitment$/],
  ['Team', '/team', /^Team$/],
  ['Settings', '/settings', /^Settings$/],
];

test.describe('every page opens', () => {
  for (const [label, path, heading] of PAGES) {
    test(label, async ({ page }) => {
      await open(page, path, heading);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }
});

test('the sidebar links lead to each page', async ({ page }) => {
  await open(page, '', PAGES[0][2]);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [label, path, heading] of PAGES.slice(1)) {
    await nav.getByRole('link', { name: new RegExp(`^${label}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/t/1${path}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});

test('menu search jumps to a page with Ctrl+K', async ({ page }) => {
  await open(page, '', PAGES[0][2]);
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search menu' }).fill('refund');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/t\/1\/refunds$/);
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a wrong password is refused with a message', async ({ page }) => {
    await signIn(page, 'owner@demo.smartpos.test', 'WrongPass999');
    await expect(page.getByText(/incorrect|invalid|do not match|wrong/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('sign in and sign out', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/t\/1$/);
    await page.getByRole('button', { name: /Maria Santos/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Sign out?' }).getByRole('button', { name: 'OK' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
