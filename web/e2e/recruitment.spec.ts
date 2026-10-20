import { type Browser, type Page } from '@playwright/test';
import { expect, test, TENANT } from './fixtures';

/**
 * The whole hiring path in a real browser, each person in their own browser window:
 * owner posts a job → applicant applies on the careers page → owner, HR and the branch manager are alerted →
 * HR screens and interviews → manager interviews → owner approves → HR sends the offer → applicant accepts →
 * onboarding → SmartPOS account created. Also "email me my link" on the status page.
 */
const PASSWORD = 'DemoPass123';
const BUSINESS = 'aling-nena-mini-mart';
const HR = { email: 'hr@demo.smartpos.test', name: 'Rosa Villanueva' };
const MANAGER = { email: 'manager@demo.smartpos.test', name: 'Jose Reyes' };
const OWNER = { email: 'owner@demo.smartpos.test', name: 'Maria Santos' };

const tinyPng = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex') });

/** A separate signed-in browser window (cookies are not shared). */
async function staffWindow(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  page.on('pageerror', (err) => { throw new Error(`[${email}] Page error: ${err.message}`); });
  page.on('response', (res) => { if (res.status() >= 500) throw new Error(`[${email}] HTTP ${res.status()} ${res.url()}`); });
  await page.goto('/login');
  const status = await page.evaluate(async ({ email, password }) => {
    await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
    const xsrf = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))!.split('=')[1]);
    const r = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf }, body: JSON.stringify({ email, password }) });
    return r.status;
  }, { email, password: PASSWORD });
  expect(status, `${email} signs in`).toBe(200);
  return page;
}

/** Opens one application from the Recruitment page. */
async function openApplication(page: Page, reference: string) {
  await page.goto(`${TENANT}/recruitment`);
  await expect(page.getByRole('heading', { level: 1, name: 'Recruitment' })).toBeVisible();
  await page.getByPlaceholder('Name, email or reference').fill(reference);
  await page.getByRole('button', { name: new RegExp(reference) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(reference)).toBeVisible();
  return dialog;
}

/** Chooses the option whose text contains `text` in a <select> found by label. */
async function chooseOption(scope: Page | ReturnType<Page['getByRole']>, label: string, text: string) {
  const select = scope.getByLabel(label);
  await expect(select.locator('option', { hasText: text })).toHaveCount(1);
  const value = await select.locator('option', { hasText: text }).getAttribute('value');
  await select.selectOption(value!);
}

const inTwoDays = () => {
  const d = new Date(Date.now() + 2 * 86400000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
};

/** Schedules the current interview stage with the named interviewer. */
async function schedule(dialog: ReturnType<Page['getByRole']>, interviewer: string) {
  await chooseOption(dialog, 'Interviewer', interviewer);
  await dialog.getByLabel('Date and time').fill(inTwoDays());
  await dialog.getByLabel('Location or link').fill('Main branch office');
  await dialog.getByRole('button', { name: 'Schedule interview' }).click();
  await expect(dialog.getByRole('button', { name: 'Reschedule' })).toBeVisible();
}

/** The interviewer records a passing result. */
async function recordResult(dialog: ReturnType<Page['getByRole']>, decision: RegExp) {
  await dialog.getByRole('button', { name: 'Record interview result' }).click();
  await dialog.getByLabel(/Feedback/).fill('Good answers, friendly, ready to work.');
  await dialog.getByRole('radio', { name: decision }).check();
  await dialog.getByRole('button', { name: 'Save result' }).click();
}

test('hiring path: apply, alerts, three interviews, offer, onboarding, account', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString(36);
  const title = `E2E Cashier ${stamp}`;
  const email = `applicant.${stamp}@example.com`;

  // 1. Owner posts a vacancy at the manager's branch.
  await page.goto(`${TENANT}/recruitment`);
  await page.getByRole('tab', { name: 'Vacancies' }).click();
  await page.getByRole('button', { name: 'New vacancy' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Position title').fill(title);
  await chooseOption(form, 'Branch', 'Main');
  await form.getByLabel('Description').fill('Serve customers at the counter.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(title)).toBeVisible();

  // 2. Applicant (no account) applies on the careers page.
  const applicantContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const applicant = await applicantContext.newPage();
  applicant.on('pageerror', (err) => { throw new Error(`[applicant] Page error: ${err.message}`); });
  await applicant.goto(`/careers/${BUSINESS}`);
  await expect(applicant.getByRole('link', { name: /Back to sign in/ })).toBeVisible();
  const card = applicant.getByRole('listitem').filter({ hasText: title });
  await card.getByRole('button', { name: 'Apply now' }).click();
  await applicant.getByLabel('First name').fill('Liza');
  await applicant.getByLabel('Last name').fill(`Tester ${stamp}`);
  await applicant.getByLabel('Email').fill(email);
  await applicant.getByLabel('Mobile number').fill('09171234567');
  await applicant.getByLabel('Resume / CV').setInputFiles(tinyPng('resume.png'));
  await applicant.getByLabel('Valid government ID').setInputFiles(tinyPng('id.png'));
  await expect(applicant.getByText('Attached')).toHaveCount(2);
  await applicant.getByRole('checkbox', { name: /process my personal data/ }).check();
  await applicant.getByRole('button', { name: 'Submit application' }).click();
  await expect(applicant).toHaveURL(/applications\/status\?ref=APP-/);
  const statusUrl = applicant.url();
  const reference = new URL(statusUrl).searchParams.get('ref')!;
  await expect(applicant.getByText(reference).first()).toBeVisible();

  // 3. Owner, HR and the branch manager each get a "New job application" alert.
  const hr = await staffWindow(browser, HR.email);
  const manager = await staffWindow(browser, MANAGER.email);
  for (const [who, p] of [['owner', page], ['HR', hr], ['manager', manager]] as const) {
    const titles = await p.evaluate(async () => {
      const r = await fetch('/api/v1/tenants/1/notifications?per_page=30', { credentials: 'include', headers: { Accept: 'application/json' } });
      return ((await r.json()).data as { type: string; body: string }[]).filter((n) => n.type === 'application_received').map((n) => n.body);
    });
    expect(titles.some((b) => b.includes(title)), `${who} is alerted`).toBe(true);
  }

  // 4. HR screens, schedules and runs the HR interview.
  let dialog = await openApplication(hr, reference);
  await dialog.getByRole('button', { name: 'Start HR screening' }).click();
  await dialog.getByRole('button', { name: 'Save screening result' }).click();
  await expect(dialog.getByLabel('Interviewer')).toBeVisible();
  await schedule(dialog, HR.name);
  await recordResult(dialog, /Pass to manager interview/);
  await expect(dialog.getByText('Manager Interview').first()).toBeVisible();

  // 5. HR schedules the manager interview; the manager records the result.
  await schedule(dialog, MANAGER.name);
  dialog = await openApplication(manager, reference);
  await recordResult(dialog, /Recommend to owner/);
  await expect(dialog.getByText(/Final Interview/i).first()).toBeVisible();

  // 6. The applicant sees the stage, never the internal feedback.
  await applicant.reload();
  await expect(applicant.getByText(/Final Interview/i).first()).toBeVisible();
  await expect(applicant.getByText('Good answers')).toHaveCount(0);

  // 7. HR schedules the owner's interview; the owner approves.
  dialog = await openApplication(hr, reference);
  await schedule(dialog, OWNER.name);
  dialog = await openApplication(page, reference);
  await recordResult(dialog, /Approve hiring/);

  // 8. HR sends the offer; the applicant accepts it online.
  dialog = await openApplication(hr, reference);
  await dialog.getByLabel('Monthly salary (₱, optional)').fill('15000');
  await dialog.getByLabel('Start date').fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Send offer' }).click();
  await expect(dialog.getByText(/The applicant can accept or decline/)).toBeVisible();
  await applicant.reload();
  await applicant.getByRole('button', { name: 'Accept offer' }).click();
  await expect(applicant.getByRole('button', { name: 'Accept offer' })).toHaveCount(0);

  // 9. Onboarding: verify documents, tick the checklist, create the account.
  dialog = await openApplication(hr, reference);
  await dialog.getByRole('button', { name: 'Start onboarding' }).click();
  await expect(dialog.getByText('Onboarding checklist')).toBeVisible();
  await dialog.getByRole('tab', { name: /Documents/ }).click();
  for (const btn of await dialog.getByRole('button', { name: 'Verify', exact: true }).all()) await btn.click();
  await expect(dialog.getByRole('button', { name: 'Verify', exact: true })).toHaveCount(0);
  for (const box of await dialog.locator('ul li input[type=checkbox]').all()) {
    if (!(await box.isChecked())) { await box.click(); await expect(box).toBeChecked(); }
  }
  await dialog.getByRole('button', { name: /Create account/ }).click();
  await expect(hr.getByRole('dialog').getByText('Employee account created')).toBeVisible();

  // 10. The applicant's page now says hired.
  await applicant.reload();
  await expect(applicant.getByText(/Hired/).first()).toBeVisible();
  await applicantContext.close();
});

test('status page: email me my link, and wrong codes are refused', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/applications/status');
  await page.getByLabel('The email you applied with').fill('nobody@example.com');
  await page.getByRole('button', { name: 'Email me my application link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  await page.getByText('I have my reference and access key').click();
  await page.getByLabel('Application reference').fill('10');
  await page.getByLabel('Access key').fill('someone@example.com');
  await page.getByRole('button', { name: 'View application' }).click();
  await expect(page.getByText(/Application not found/)).toBeVisible();
  await context.close();
});

test('HR cancels an interview and the applicant withdraws', async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const applicantContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const applicant = await applicantContext.newPage();
  await applicant.goto(`/careers/${BUSINESS}`);
  await applicant.getByRole('button', { name: 'Apply now' }).first().click();
  await applicant.getByLabel('First name').fill('Marco');
  await applicant.getByLabel('Last name').fill(`Withdraw ${stamp}`);
  await applicant.getByLabel('Email').fill(`withdraw.${stamp}@example.com`);
  await applicant.getByLabel('Mobile number').fill('09181234567');
  for (const input of await applicant.locator('input[type=file][aria-label]:not([aria-label="File"])').all()) await input.setInputFiles(tinyPng('doc.png'));
  await applicant.getByRole('checkbox', { name: /process my personal data/ }).check();
  await applicant.getByRole('button', { name: 'Submit application' }).click();
  await expect(applicant).toHaveURL(/ref=APP-/);
  const reference = new URL(applicant.url()).searchParams.get('ref')!;

  const hr = await staffWindow(browser, HR.email);
  const dialog = await openApplication(hr, reference);
  await dialog.getByRole('button', { name: 'Start HR screening' }).click();
  await dialog.getByRole('button', { name: 'Save screening result' }).click();
  await schedule(dialog, HR.name);
  await dialog.getByRole('button', { name: 'Cancel interview' }).click();
  await dialog.getByLabel('Why is this interview cancelled?').fill('Interviewer is sick');
  await dialog.getByRole('button', { name: 'Cancel interview' }).click();
  await expect(dialog.getByRole('button', { name: 'Schedule interview' })).toBeVisible();

  await applicant.reload();
  await applicant.getByRole('button', { name: 'Withdraw my application' }).click();
  await applicant.getByPlaceholder('You can tell us why (optional)').fill('Found another job');
  await applicant.getByRole('button', { name: 'Withdraw application' }).click();
  await expect(applicant.getByText('Application withdrawn', { exact: true })).toBeVisible();
  await expect(applicant.getByText('Application submitted')).toHaveCount(0);
  await expect(applicant.getByRole('button', { name: 'Withdraw my application' })).toHaveCount(0);
  await applicantContext.close();
});
