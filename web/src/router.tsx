import type { ComponentType } from 'react';
import { ErrorPage } from './pages/ErrorPage';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { Spinner } from './components/ui';
import { TenantLayout } from './components/TenantLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/PasswordRecoveryPages';
import { SelectBusinessPage } from './pages/auth/SelectBusinessPage';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage';
import { ApplicationStatusPage } from './pages/careers/ApplicationStatusPage';
import { CareersIndexPage, CareersPage } from './pages/careers/CareersPage';
import { NotFoundPage } from './pages/NotFoundPage';

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // A temporary password from a manager must be replaced before anything else (the API enforces this too).
  if (user.must_change_password && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}

/** Load a page module on first visit so each screen ships as its own chunk. */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

export const router = createBrowserRouter([{ errorElement: <ErrorPage />, children: [
  // Public careers pages: no sign-in needed (applicants have no SmartPOS account).
  { path: '/careers', element: <CareersIndexPage /> },
  { path: '/careers/:code', element: <CareersPage /> },
  { path: '/applications/status', element: <ApplicationStatusPage /> },
  { path: '/shop', lazy: page(() => import('./pages/shop/ShopDirectory'), 'ShopIndexPage') },
  { path: '/shop/:business', lazy: page(() => import('./pages/shop/ShopPage'), 'ShopPage') },
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <SelectBusinessPage /> },
      { path: '/change-password', element: <ChangePasswordPage /> },
      { path: '/platform', lazy: page(() => import('./pages/platform/PlatformPage'), 'PlatformPage') },
      {
        path: '/t/:tenantId',
        element: <TenantLayout />,
        hydrateFallbackElement: <Spinner />,
        children: [
          { index: true, lazy: page(() => import('./pages/DashboardPage'), 'DashboardPage') },
          { path: 'pos', lazy: page(() => import('./pages/pos/PosPage'), 'PosPage') },
          { path: 'sales', lazy: page(() => import('./pages/sales/SalesPage'), 'SalesPage') },
          { path: 'sales/:saleId', lazy: page(() => import('./pages/sales/SaleDetailPage'), 'SaleDetailPage') },
          { path: 'refunds', lazy: page(() => import('./pages/sales/RefundsPage'), 'RefundsPage') },
          { path: 'shifts', lazy: page(() => import('./pages/pos/ShiftsPage'), 'ShiftsPage') },
          { path: 'products', lazy: page(() => import('./pages/catalog/ProductsPage'), 'ProductsPage') },
          { path: 'categories', lazy: page(() => import('./pages/catalog/CategoriesPage'), 'CategoriesPage') },
          { path: 'inventory', lazy: page(() => import('./pages/inventory/InventoryPage'), 'InventoryPage') },
          { path: 'transfers', lazy: page(() => import('./pages/inventory/TransfersPage'), 'TransfersPage') },
          { path: 'purchasing', lazy: page(() => import('./pages/purchasing/PurchasingPage'), 'PurchasingPage') },
          { path: 'customers', lazy: page(() => import('./pages/operations/CustomersPage'), 'CustomersPage') },
          { path: 'online-orders', lazy: page(() => import('./pages/operations/OnlineOrdersPage'), 'OnlineOrdersPage') },
          { path: 'deliveries', lazy: page(() => import('./pages/operations/DeliveriesPage'), 'DeliveriesPage') },
          { path: 'expenses', lazy: page(() => import('./pages/operations/ExpensesPage'), 'ExpensesPage') },
          { path: 'reports', lazy: page(() => import('./pages/reports/ReportsPage'), 'ReportsPage') },
          { path: 'audit', lazy: page(() => import('./pages/reports/AuditLogPage'), 'AuditLogPage') },
          { path: 'recruitment', lazy: page(() => import('./pages/recruitment/RecruitmentPage'), 'RecruitmentPage') },
          { path: 'team', lazy: page(() => import('./pages/admin/TeamPage'), 'TeamPage') },
          { path: 'settings', lazy: page(() => import('./pages/admin/SettingsPage'), 'SettingsPage') },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]}]);
