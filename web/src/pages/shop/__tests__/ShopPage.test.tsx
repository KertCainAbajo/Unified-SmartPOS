import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../components/Confirm';
import { ToastProvider } from '../../../components/Toast';
import { ShopPage } from '../ShopPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const catalog = {
  business: { name: 'Test Mart', code: 'test-mart' },
  branches: [{ id: 7, code: 'MAIN', name: 'Main Branch', address: '1 Rizal Ave.' }],
  data: [
    { id: 1, sku: 'A1', name: 'Bath Soap', description: null, unit: 'pc', price: '35.00', category: 'Personal Care' },
    { id: 2, sku: 'B1', name: 'Cola 1L', description: null, unit: 'pc', price: '65.00', category: 'Beverages' },
  ],
};
const placed = { id: 9, order_number: 'ONL-0009', status: 'pending', estimated_total: '70.00', placed_at: '2026-10-17T09:00:00Z', branch: { name: 'Main Branch' }, items: [{ id: 1, name: 'Bath Soap', quantity: '2.000', unit: 'pc', line_total: '70.00' }] };

function serve(signedIn: boolean) {
  const orders: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url === '/sanctum/csrf-cookie') { document.cookie = 'XSRF-TOKEN=t'; return new Response(null, { status: 204 }); }
    if (url.endsWith('/me')) return signedIn ? json({ data: { id: 1, name: 'Ana Reyes', email: 'ana@example.com', phone: '0917' } }) : json({ message: 'Unauthenticated.' }, 401);
    if (url.endsWith('/orders') && init?.method === 'POST') { orders.push(placed); return json({ data: placed }, 201); }
    if (url.endsWith('/orders')) return json({ data: orders });
    return json(catalog);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><ConfirmProvider>
        <MemoryRouter initialEntries={['/shop/test-mart']}><Routes><Route path="/shop/:business" element={<ShopPage />} /></Routes></MemoryRouter>
      </ConfirmProvider></ToastProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

it('lets a guest fill a basket and asks them to sign in before ordering', async () => {
  serve(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Bath Soap' }));
  expect(screen.getByLabelText('1 in basket')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Sign in to place order/ }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getByText('Your basket is saved')).toBeTruthy();
});

it('saves products with the heart and filters to them', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  serve(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Save Cola 1L' }));

  fireEvent.click(screen.getByRole('button', { name: /^Saved/ }));
  expect(screen.getByRole('heading', { name: 'Cola 1L' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Bath Soap' })).toBeNull();
  expect(JSON.parse(store.get('shop-saved:test-mart') ?? '[]')).toEqual([2]);
});

it('places a pickup order for a signed-in customer and shows it in their orders', async () => {
  const fetchMock = serve(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Bath Soap' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Add one Bath Soap' })[0]); // product card and basket both have a stepper
  expect((await screen.findByRole('button', { name: 'Choose a branch' }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(within(document.getElementById('basket')!).getByRole('button', { name: /Main Branch/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Place pickup order/ }));

  expect(await screen.findByText('Order ONL-0009 placed')).toBeTruthy();
  const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/orders') && init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ branch_id: 7, contact_name: 'Ana Reyes', items: [{ product_id: 1, quantity: 2 }] });
  await waitFor(() => expect(screen.getByRole('button', { name: /Cancel order/ })).toBeTruthy());
});
