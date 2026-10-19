import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/caveat/700.css';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ApiError } from './lib/api';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { router } from './router';
import { isShopApp, shopAppPath } from './lib/shopApp';
import { installTableCards } from './lib/tableCards';
import './index.css';

const queryClient: QueryClient = new QueryClient({
  // A 401 anywhere means the session is gone (signed out elsewhere, expired): show the sign-in page.
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== 'me') queryClient.setQueryData(['me'], null);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Never retry authorization/validation failures; retry transient errors once.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
});

// Inside the customer phone app, only the shop pages are reachable: opening or navigating anywhere else returns
// to the shop (see lib/shopApp.ts).
if (isShopApp()) {
  // A full page load to the shop (rather than an in-app navigation) so it never fights the router mid-navigation.
  const start = shopAppPath(window.location.pathname);
  if (start) window.location.replace(start);
  router.subscribe((state) => {
    const back = shopAppPath(state.location.pathname);
    if (back) window.location.replace(back);
  });
}

// List tables become one card per row on phones (lib/tableCards.ts + index.css).
installTableCards();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
