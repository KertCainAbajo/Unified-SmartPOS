import { expect, open, test } from './fixtures';

test.describe.serial('stock', () => {
  test('adjust stock down, then restock it from the low-stock list', async ({ page }) => {
    await open(page, '/inventory', 'Inventory');

    // Record 55 damaged Coca-Cola at Main (60 → 5, below the reorder level of 10).
    await page.getByRole('button', { name: 'Adjust stock' }).click();
    const adjust = page.getByRole('dialog', { name: 'Adjust stock' });
    await adjust.getByLabel('Reason').selectOption('damaged');
    await adjust.getByLabel('Search product').fill('Coca');
    await adjust.getByRole('button', { name: /Coca-Cola 1L/ }).click();
    await adjust.getByLabel('Quantity change Coca-Cola 1L').fill('-55');
    await adjust.getByRole('button', { name: 'Post adjustment' }).click();
    await expect(page.getByText('Stock adjusted.')).toBeVisible();

    await page.getByRole('tab', { name: /Low stock/ }).click();
    const row = page.getByRole('row', { name: /Coca-Cola 1L/ });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Restock' }).click();

    const restock = page.getByRole('dialog', { name: 'Restock' });
    await restock.getByRole('radio', { name: /Delivery arrived/ }).click();
    // Pre-filled to bring stock up to 2 × the reorder level (20), whatever is on hand now.
    const qty = Number(await restock.getByLabel('Quantity to add for Coca-Cola 1L').inputValue());
    expect(qty).toBeGreaterThanOrEqual(15);
    await restock.getByRole('button', { name: `Add ${qty} units to stock` }).click();
    await expect(page.getByText(`${qty} units added to Main Branch - Quezon City.`)).toBeVisible();
    await expect(page.getByRole('row', { name: /Coca-Cola 1L/ })).toHaveCount(0);
  });

  test('order from a supplier without typing, then receive everything', async ({ page }) => {
    await open(page, '/purchasing', 'Purchasing');
    await page.getByRole('button', { name: 'New purchase order' }).click();

    const po = page.getByRole('dialog', { name: 'New purchase order' });
    await po.getByRole('button', { name: /Metro Manila Distributors Inc\./ }).click();
    await po.getByRole('button', { name: /Choose products to add/ }).click();
    await po.getByRole('option', { name: /Bath Soap 90g/ }).click();
    await po.getByRole('option', { name: /Bath Soap 90g/ }).click(); // tap again = 2
    await po.getByRole('button', { name: 'Done' }).click();
    await expect(po.getByLabel('Quantity Bath Soap 90g')).toHaveValue('2');
    await po.getByRole('button', { name: 'Send order' }).click();
    await expect(page.getByText(/sent\. Receive it here/)).toBeVisible();

    const order = page.getByRole('button', { name: /Metro Manila Distributors Inc\..*Ordered/ }).first();
    await order.click();
    const detail = page.getByRole('dialog', { name: 'Metro Manila Distributors Inc.' });
    await detail.getByRole('button', { name: 'Receive everything' }).click();
    await expect(page.getByText('Everything received into stock.')).toBeVisible();
  });

  test('move stock between branches', async ({ page }) => {
    await open(page, '/transfers', 'Stock transfers');
    await page.getByRole('button', { name: 'New transfer' }).first().click();
    const form = page.getByRole('dialog', { name: 'New stock transfer' });
    await form.getByLabel('To branch').selectOption({ label: 'Makati Branch' });
    await form.getByLabel('Search product').fill('Sardines');
    await form.getByRole('button', { name: /Sardines in Tomato Sauce/ }).click();
    await form.getByLabel(/Quantity Sardines/).fill('3');
    await form.getByRole('button', { name: 'Create transfer' }).click();
    await expect(page.getByText(/Transfer created as draft/)).toBeVisible();

    await page.getByRole('button', { name: /Main Branch - Quezon City.*Makati Branch.*Draft/ }).first().click();
    const detail = page.getByRole('dialog', { name: /Transfer/ });
    await detail.getByRole('button', { name: 'Dispatch' }).click();
    await expect(page.getByText('Transfer updated.').first()).toBeVisible();
  });
});

test('record an expense', async ({ page }) => {
  await open(page, '/expenses', 'Expenses');
  await page.getByRole('button', { name: 'Record expense' }).first().click();
  const form = page.getByRole('dialog', { name: 'Record expense' });
  await form.getByLabel('Amount').fill('1250.50');
  await form.getByLabel('Category').selectOption({ index: 1 });
  await form.getByLabel('Description').fill('Electricity bill — E2E');
  await form.getByRole('radio', { name: 'GCash' }).click();
  await form.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Expense recorded.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Electricity bill — E2E/ })).toBeVisible();
});

test('switch to all branches and back', async ({ page }) => {
  await open(page, '/sales', 'Sales');
  await page.getByRole('button', { name: 'Branch' }).click();
  await page.getByRole('option', { name: /All branches/ }).click();
  await expect(page.getByText('All 2 branches')).toBeVisible();
  await page.getByRole('button', { name: 'Branch' }).click();
  await page.getByRole('option', { name: /Main Branch - Quezon City/ }).click();
  await expect(page.getByText('All 2 branches')).toHaveCount(0);
});

test('team is grouped by position', async ({ page }) => {
  await open(page, '/team', 'Team');
  const cashier = page.getByRole('button', { name: /^Cashier \d+$/ });
  await cashier.click();
  await expect(cashier).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('row', { name: /Ana Cruz/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Jose Reyes/ })).toHaveCount(0);
});

test('settings tabs and the unsaved-changes bar', async ({ page }) => {
  await open(page, '/settings', 'Settings');
  await page.getByLabel('Business name').fill('Aling Nena Mini Mart (edited)');
  await expect(page.getByText('You have unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('Business name')).toHaveValue('Aling Nena Mini Mart');

  await page.getByRole('button', { name: /Tax & pricing/ }).click();
  await expect(page.getByText('Receipt preview')).toBeVisible();
  await page.getByRole('button', { name: /Account & security/ }).click();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeDisabled();
});

test('reports show the sales chart', async ({ page }) => {
  await open(page, '/reports', 'Reports');
  await expect(page.getByText('Sales over time')).toBeVisible();
  for (const tab of ['By branch / cashier / payment', 'Products & stock', 'Profit & expenses']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});
