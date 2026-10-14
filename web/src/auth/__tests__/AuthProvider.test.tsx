import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../AuthProvider';

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { user, loading, logout } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <>
      <p>{user ? `user:${user.name}` : 'signed out'}</p>
      <button onClick={() => void logout()}>sign out</button>
    </>
  );
}

it('forgets the user immediately after signing out', async () => {
  let signedIn = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/sanctum/csrf-cookie') {
      document.cookie = 'XSRF-TOKEN=t';
      return new Response(null, { status: 204 });
    }
    if (url === '/api/v1/auth/logout') {
      signedIn = false;
      return new Response('{}', { status: 200 });
    }
    return signedIn
      ? new Response(JSON.stringify({ data: { id: 1, name: 'Maria Santos' } }), { status: 200 })
      : new Response(JSON.stringify({ message: 'Unauthenticated.' }), { status: 401 });
  }));

  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );

  expect(await screen.findByText('user:Maria Santos')).toBeTruthy();
  await act(async () => screen.getByText('sign out').click());
  await waitFor(() => expect(screen.getByText('signed out')).toBeTruthy());
});
