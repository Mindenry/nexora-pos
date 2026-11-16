import { lazy } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell, RequireAuth } from './components/shell';
import { useAuth } from './lib/auth';
import { LoginPage, RegisterPage } from './pages/auth';
import { NotFoundPage } from './pages/not-found';

const OnboardingPage = lazy(() => import('./pages/onboarding').then((m) => ({ default: m.OnboardingPage })));
const DashboardPage = lazy(() => import('./pages/dashboard').then((m) => ({ default: m.DashboardPage })));
const PosPage = lazy(() => import('./pages/pos').then((m) => ({ default: m.PosPage })));
const SalesPage = lazy(() => import('./pages/sales').then((m) => ({ default: m.SalesPage })));
const SaleDetailPage = lazy(() => import('./pages/sale-detail').then((m) => ({ default: m.SaleDetailPage })));
const ProductsPage = lazy(() => import('./pages/products').then((m) => ({ default: m.ProductsPage })));
const InventoryPage = lazy(() => import('./pages/inventory').then((m) => ({ default: m.InventoryPage })));
const PurchasingPage = lazy(() => import('./pages/purchasing').then((m) => ({ default: m.PurchasingPage })));
const CustomersPage = lazy(() => import('./pages/customers').then((m) => ({ default: m.CustomersPage })));
const PromotionsPage = lazy(() => import('./pages/promotions').then((m) => ({ default: m.PromotionsPage })));
const ShiftsPage = lazy(() => import('./pages/shifts').then((m) => ({ default: m.ShiftsPage })));
const PromptPayPage = lazy(() =>
  import('./pages/promptpay').then((m) => ({ default: m.PromptPayPage })),
);
const ReportsPage = lazy(() => import('./pages/reports').then((m) => ({ default: m.ReportsPage })));
const EmployeesPage = lazy(() => import('./pages/employees').then((m) => ({ default: m.EmployeesPage })));
const SettingsPage = lazy(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })));
const PlatformPage = lazy(() => import('./pages/platform').then((m) => ({ default: m.PlatformPage })));
const CustomerDisplayPage = lazy(() => import('./pages/display').then((m) => ({ default: m.CustomerDisplayPage })));

function IndexRedirect() {
  const { me, can } = useAuth();
  if (!me) return <Navigate to="/login" replace />;
  if (me.user.isPlatformAdmin && !me.employee) return <Navigate to="/platform" replace />;
  if (can('reports.view')) return <Navigate to="/dashboard" replace />;
  if (can('sales.create')) return <Navigate to="/pos" replace />;
  return <Navigate to="/sales" replace />;
}

function BusinessOnly() {
  const { me } = useAuth();
  if (me?.user.isPlatformAdmin && !me.employee) return <Navigate to="/platform" replace />;
  if (!me?.employee) return <Navigate to="/login" replace />;
  if (!me.tenant?.onboardedAt) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

function PlatformOnly() {
  const { me, isLoading } = useAuth();
  if (isLoading) return <div className="p-10 text-sm text-muted">Loading…</div>;
  if (!me?.user.isPlatformAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

function AlreadySignedIn({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const location = useLocation();
  if (me) {
    const from = (location.state as { from?: string } | null)?.from;
    if (from) return <Navigate to={from} replace />;
    return <Navigate to={me.user.isPlatformAdmin && !me.employee ? '/platform' : '/'} replace />;
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <AlreadySignedIn>
        <LoginPage />
      </AlreadySignedIn>
    ),
  },
  {
    path: '/register',
    element: (
      <AlreadySignedIn>
        <RegisterPage />
      </AlreadySignedIn>
    ),
  },
  {
    path: '/onboarding',
    element: (
      <RequireAuth>
        <OnboardingPage />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <IndexRedirect /> },
      {
        element: <BusinessOnly />,
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'sales', element: <SalesPage /> },
          { path: 'sales/:id', element: <SaleDetailPage /> },
          { path: 'shifts', element: <ShiftsPage /> },
          { path: 'promptpay', element: <PromptPayPage /> },
          { path: 'products', element: <ProductsPage /> },
          { path: 'inventory', element: <InventoryPage /> },
          { path: 'purchasing', element: <PurchasingPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'promotions', element: <PromotionsPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'employees', element: <EmployeesPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
      {
        element: <PlatformOnly />,
        children: [{ path: 'platform', element: <PlatformPage /> }],
      },
    ],
  },
  {
    path: '/pos',
    element: (
      <RequireAuth>
        <PosPage />
      </RequireAuth>
    ),
  },
  {
    path: '/display',
    element: (
      <RequireAuth>
        <CustomerDisplayPage />
      </RequireAuth>
    ),
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
