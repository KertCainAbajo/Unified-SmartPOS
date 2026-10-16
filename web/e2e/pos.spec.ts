import { expect, test, TENANT } from './fixtures';

/** A full till session: open a shift, ring up a cash sale with change, print view, close the shift. */
test.describe.serial('point of sale', () => {
  test('open a shift at a branch with a free register', async ({ page }) => {
    await page.goto(`${TENANT}/pos`);
    await expect(page.getByRole('heading', { name: 'Open a shift' })).toBeVisible();

    // The owner's default branch (Main) has no free register: the demo cashier is selling on it.
    await page.getByRole('radiogroup', { name: 'Branch' }).getByRole('radio', { name: 'Makati Branch' }).click();
    await page.getByRole('radiogroup', { name: 'Register' }).getByRole('radio', { name: /Makati Register 1/ }).click();
    await page.getByLabel(/Opening float/).fill('500');
    await page.getByRole('button', { name: /Open shift and start selling/ }).click();

    await expect(page.getByText('Shift open', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Current sale' })).toBeVisible();
  });

  test('ring up a cash sale and give change', async ({ page }) => {
    await page.goto(`${TENANT}/pos`);
    await expect(page.getByRole('heading', { name: 'Current sale' })).toBeVisible();

    // Tap products: 2 × Coffee 3-in-1 (₱9) and 1 × Bath Soap (₱35) = ₱53.00.
    await page.getByRole('button', { name: /Coffee 3-in-1 Sachet/ }).first().click();
    await page.getByRole('button', { name: /Coffee 3-in-1 Sachet/ }).first().click();
    await page.getByRole('button', { name: /Bath Soap 90g/ }).first().click();
    await expect(page.getByText('2 items', { exact: true })).toBeVisible();

    const charge = page.getByRole('button', { name: /Charge ₱53\.00/ });
    await expect(charge).toBeEnabled();
    await charge.click();

    const payment = page.getByRole('dialog', { name: 'Payment' });
    await payment.getByLabel('How much did the customer give?').fill('1000');
    await expect(payment.getByText('₱947.00').first()).toBeVisible();
    await expect(payment.getByText(/1 × ₱500/)).toBeVisible();
    await payment.getByRole('button', { name: /Complete sale · Change ₱947\.00/ }).click();

    const done = page.getByRole('dialog', { name: 'Sale complete' });
    await expect(done.getByText('Change due')).toBeVisible();
    await expect(done.getByText('₱947.00').first()).toBeVisible();
    await expect(done.getByText('SALES INVOICE')).toBeVisible();
    await expect(done.getByText('CASH', { exact: true })).toBeVisible();
    await expect(done.getByText('CHANGE', { exact: true })).toBeVisible();
    await done.getByRole('button', { name: 'New sale' }).click();
    await expect(page.getByText('Ready for the next customer')).toBeVisible();
  });

  test('not enough cash keeps the sale open', async ({ page }) => {
    await page.goto(`${TENANT}/pos`);
    await page.getByRole('button', { name: /Toothpaste 150ml/ }).first().click();
    await page.getByRole('button', { name: /Charge ₱98\.00/ }).click();
    const payment = page.getByRole('dialog', { name: 'Payment' });
    await payment.getByLabel('How much did the customer give?').fill('50');
    await expect(payment.getByText(/Not enough/)).toBeVisible();
    await expect(payment.getByRole('button', { name: /Complete sale/ })).toBeDisabled();
    await payment.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: /Clear/ }).click();
  });

  test('close the shift and see the Z reading', async ({ page }) => {
    await page.goto(`${TENANT}/pos`);
    await page.getByRole('button', { name: 'Close shift' }).click();
    const close = page.getByRole('dialog', { name: 'Close shift' });
    // Float 500 + cash sale 53 = 553 expected in the drawer.
    await close.getByLabel('Counted cash').fill('553');
    await close.getByRole('button', { name: 'Close shift' }).click();

    const z = page.getByRole('dialog', { name: /Z reading/ });
    await expect(z).toBeVisible();
    await expect(z.getByText('Expected cash')).toBeVisible();
    await z.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Open a shift' })).toBeVisible();

    await page.goto(`${TENANT}/shifts`);
    await expect(page.getByText('Balanced').first()).toBeVisible();
  });
});
