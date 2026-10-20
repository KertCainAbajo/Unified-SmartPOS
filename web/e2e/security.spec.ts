import { test as base, expect, type Browser, type Page } from '@playwright/test';

/**
 * Attacks a hacker would try, run against the throwaway test server (never your real data):
 * missing protections, guessing passwords, reaching other people's data, forged requests, script injection,
 * database injection, self-promotion to admin, disguised file uploads and leaked secrets.
 */
const PASSWORD = 'DemoPass123';
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

type Call = { status: number; body: any; headers: Record<string, string> };

/** A request made by the page itself (cookies + the anti-forgery token, like the real app). */
async function call(page: Page, method: string, url: string, body?: unknown, opts: { csrf?: boolean } = {}): Promise<Call> {
  return page.evaluate(async ({ method, url, body, csrf }) => {
    if (csrf) await fetch('/sanctum/csrf-cookie', { credentials: 'include' });
    const xsrf = document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))?.split('=')[1];
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf);
    const r = await fetch(url, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body: parsed, headers: Object.fromEntries(r.headers.entries()) };
  }, { method, url, body, csrf: opts.csrf ?? true });
}

async function newWindow(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  return page;
}

async function signIn(browser: Browser, email: string, password = PASSWORD): Promise<Page> {
  const page = await newWindow(browser);
  const r = await call(page, 'POST', '/api/v1/auth/login', { email, password });
  expect(r.status, `${email} signs in`).toBe(200);
  return page;
}

test('1. protective headers are sent by the API and the web app', async ({ browser }) => {
  const page = await newWindow(browser);
  const api = await call(page, 'GET', '/api/v1/me');
  expect(api.headers['x-frame-options']).toBe('DENY');
  expect(api.headers['x-content-type-options']).toBe('nosniff');
  expect(api.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(api.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(api.headers['x-powered-by']).toBeUndefined();

  const web = await page.request.get('/login');
  expect(web.headers()['x-frame-options']).toBe('DENY');
  expect(web.headers()['x-content-type-options']).toBe('nosniff');
});

test('2. nothing private is reachable without signing in', async ({ browser }) => {
  const page = await newWindow(browser);
  for (const url of ['/api/v1/me', '/api/v1/tenants/1/products', '/api/v1/tenants/1/staff', '/api/v1/tenants/1/audit-logs', '/api/v1/platform/overview', '/api/v1/tenants/1/reports/sales-summary']) {
    expect((await call(page, 'GET', url)).status, url).toBe(401);
  }
});

test('3. each role is refused what it may not do', async ({ browser }) => {
  const cashier = await signIn(browser, 'cashier@demo.smartpos.test');
  expect((await call(cashier, 'GET', '/api/v1/tenants/1/staff')).status, 'cashier: staff list').toBe(403);
  expect((await call(cashier, 'GET', '/api/v1/tenants/1/audit-logs')).status, 'cashier: audit log').toBe(403);
  expect((await call(cashier, 'POST', '/api/v1/tenants/1/roles', { name: 'Hacker', permissions: ['staff.create'] })).status, 'cashier: make a role').toBe(403);
  expect((await call(cashier, 'GET', '/api/v1/platform/overview')).status, 'cashier: super admin').toBe(403);

  const manager = await signIn(browser, 'manager@demo.smartpos.test');
  expect((await call(manager, 'GET', '/api/v1/platform/users')).status, 'manager: super admin').toBe(403);
  expect((await call(manager, 'PATCH', '/api/v1/platform/users/1/admin', { is_platform_admin: true, reason: 'I want to be admin please' })).status, 'manager: make self admin').toBe(403);
});

test('4. another business cannot read or change this business', async ({ browser }) => {
  const page = await newWindow(browser);
  const stamp = Date.now().toString(36);
  const reg = await call(page, 'POST', '/api/v1/auth/register', {
    name: 'Other Owner', email: `intruder.${stamp}@example.com`, password: 'Intruder123', password_confirmation: 'Intruder123',
    business: { name: `Rival Store ${stamp}` },
  });
  expect(reg.status).toBe(201);
  for (const url of ['/api/v1/tenants/1/products', '/api/v1/tenants/1/staff', '/api/v1/tenants/1/reports/sales-summary', '/api/v1/tenants/1/customers']) {
    expect([403, 404], url).toContain((await call(page, 'GET', url)).status);
  }
  expect([403, 404]).toContain((await call(page, 'PATCH', '/api/v1/tenants/1/products/1', { name: 'Hacked' })).status);
});

test('5. a hostile website cannot act for a signed-in owner (forged request)', async ({ browser }) => {
  const owner = await signIn(browser, 'owner@demo.smartpos.test');
  const name = `CSRF-${Date.now()}`;
  // Another site (here a blank page, so a different origin) silently posts a form to our API while the owner is signed in.
  const evil = await owner.context().newPage();
  await evil.goto('about:blank');
  await evil.evaluate(async ({ url, name }) => {
    const body = new URLSearchParams({ name });
    await fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'include', body }).catch(() => undefined);
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: url });
    form.appendChild(Object.assign(document.createElement('input'), { name: 'name', value: name }));
    document.body.appendChild(form);
  }, { url: `${new URL(owner.url()).origin}/api/v1/tenants/1/categories`, name });
  await evil.waitForTimeout(1000);
  await evil.close();

  const categories = await call(owner, 'GET', '/api/v1/tenants/1/categories?per_page=100');
  expect(JSON.stringify(categories.body)).not.toContain(name);
  // The same request from the app itself works, so the refusal above is the protection, not a broken endpoint.
  const ok = await call(owner, 'POST', '/api/v1/tenants/1/categories', { name });
  expect(ok.status).toBe(201);
  await call(owner, 'DELETE', `/api/v1/tenants/1/categories/${ok.body.data.id}`);
});

test('6. password guessing pauses the account, even for the right password', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newWindow(browser);
  const stamp = Date.now().toString(36);
  const email = `victim.${stamp}@example.com`;
  expect((await call(page, 'POST', '/api/v1/auth/register', { name: 'Victim', email, password: 'Victim12345', password_confirmation: 'Victim12345', business: { name: `Victim Store ${stamp}` } })).status).toBe(201);
  await call(page, 'POST', '/api/v1/auth/logout');

  const attacker = await newWindow(browser);
  for (let i = 1; i <= 5; i++) {
    expect((await call(attacker, 'POST', '/api/v1/auth/login', { email, password: `guess-${i}A1` })).status, `guess ${i}`).toBe(422);
  }
  // The 6th try, with the RIGHT password, is refused: by the per-minute speed limit (normal strength) or, once
  // that resets, by the 15-minute account pause.
  let r = await call(attacker, 'POST', '/api/v1/auth/login', { email, password: 'Victim12345' });
  if (r.status === 429) {
    await attacker.waitForTimeout(61_000);
    r = await call(attacker, 'POST', '/api/v1/auth/login', { email, password: 'Victim12345' });
  }
  expect(r.status).toBe(422);
  expect(JSON.stringify(r.body)).toContain('paused');
});

test('7. script injection is shown as text, never run', async ({ browser }) => {
  const owner = await signIn(browser, 'owner@demo.smartpos.test');
  const products = await call(owner, 'GET', '/api/v1/tenants/1/products?per_page=1');
  const product = products.body.data[0];
  const evil = `<img src=x onerror="window.__xss=1">XSS-${Date.now()}`;
  expect((await call(owner, 'PATCH', `/api/v1/tenants/1/products/${product.id}`, { name: evil })).status).toBe(200);
  try {
    await owner.goto(`/t/1/products?q=${encodeURIComponent('XSS-')}`);
    await expect(owner.getByText(evil).first()).toBeVisible();
    expect(await owner.evaluate(() => (window as any).__xss)).toBeUndefined();

    const shop = await newWindow(browser);
    await shop.goto('/shop/aling-nena-mini-mart');
    await shop.waitForTimeout(2500);
    expect(await shop.evaluate(() => (window as any).__xss)).toBeUndefined();
  } finally {
    await call(owner, 'PATCH', `/api/v1/tenants/1/products/${product.id}`, { name: product.name });
  }
});

test('8. database injection does nothing', async ({ browser }) => {
  const owner = await signIn(browser, 'owner@demo.smartpos.test');
  for (const q of ["' OR '1'='1", "'; DROP TABLE products; --", '" OR ""="', '%_%']) {
    const r = await call(owner, 'GET', `/api/v1/tenants/1/products?q=${encodeURIComponent(q)}`);
    expect(r.status, q).toBe(200);
    expect(r.body.data.length, q).toBe(0);
  }
  const anon = await newWindow(browser);
  expect((await call(anon, 'POST', '/api/v1/auth/login', { email: "' OR 1=1 --", password: 'x' })).status).toBe(422);
  expect((await call(owner, 'GET', '/api/v1/tenants/1/products?per_page=1')).body.data.length).toBe(1); // table still there
});

test('9. users cannot promote themselves or change protected fields', async ({ browser }) => {
  const cashier = await signIn(browser, 'cashier@demo.smartpos.test');
  await call(cashier, 'PATCH', '/api/v1/me', { name: 'Ana Cruz', is_platform_admin: true, status: 'active', must_change_password: false, managed_by_tenant_id: null });
  const me = await call(cashier, 'GET', '/api/v1/me');
  expect(me.body.data.is_platform_admin).toBeFalsy();
  expect((await call(cashier, 'GET', '/api/v1/platform/overview')).status).toBe(403);
});

test('10. disguised files are refused on the careers form', async ({ browser }) => {
  const page = await newWindow(browser);
  const vacancies = await call(page, 'GET', '/api/v1/careers/aling-nena-mini-mart/vacancies');
  const vacancy = vacancies.body.data[0];
  // A harmless PHP script and a real web shell, both named like a photo. (Antivirus may delete the web shell on
  // arrival; the server must still answer with a clean refusal, not crash.)
  for (const content of ['<?php echo "hello"; ?>', '<?php system($_GET["c"]); ?>']) {
    const r = await page.evaluate(async ({ id, docs, content }) => {
      const form = new FormData();
      Object.entries({ first_name: 'Evil', last_name: 'Upload', email: 'evil@example.com', phone: '09170000000', privacy_consent: '1' }).forEach(([k, v]) => form.append(k, v));
      docs.forEach((type: string, i: number) => {
        form.append(`documents[${i}][type]`, type);
        form.append(`documents[${i}][file]`, new File([content], 'photo.php.png', { type: 'image/png' }));
      });
      const res = await fetch(`/api/v1/careers/aling-nena-mini-mart/vacancies/${id}/apply`, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
      return { status: res.status, text: await res.text() };
    }, { id: vacancy.id, docs: vacancy.required_documents.map((d: { type: string }) => d.type), content });
    expect(r.status, `${content} → ${r.text.slice(0, 400)}`).toBe(422);
    expect(r.text).not.toContain('exception');
  }
});

test('11. no secrets leak: password hashes, session cookie, account existence', async ({ browser }) => {
  const owner = await signIn(browser, 'owner@demo.smartpos.test');
  for (const url of ['/api/v1/me', '/api/v1/tenants/1/staff']) {
    const text = JSON.stringify((await call(owner, 'GET', url)).body);
    expect(text, url).not.toMatch(/\$2y\$|"password"|remember_token|token_hash/);
  }
  const cookies = await owner.context().cookies();
  const session = cookies.find((c) => /session/i.test(c.name));
  expect(session?.httpOnly, 'session cookie hidden from scripts').toBe(true);

  // "Forgot password" answers the same for real and unknown emails.
  const anon = await newWindow(browser);
  const real = await call(anon, 'POST', '/api/v1/auth/forgot-password', { email: 'manager@demo.smartpos.test' });
  const fake = await call(anon, 'POST', '/api/v1/auth/forgot-password', { email: 'nobody-here@example.com' });
  expect(real.status).toBe(fake.status);
  expect(real.body.message).toBe(fake.body.message);
});
