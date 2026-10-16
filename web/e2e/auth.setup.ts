import { expect, test as setup } from '@playwright/test';
import { signIn } from './fixtures';

/** Signs the owner in once and saves the session for the other tests. */
setup('sign in as the owner', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/t\/1$/);
  await expect(page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.context().storageState({ path: 'e2e/.auth/owner.json' });
});
