import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/500.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import '@fontsource/ibm-plex-sans-thai/700.css';
import './styles.css';
import { router } from './App';
import { AuthProvider } from './lib/auth';
import { LangProvider } from './lib/i18n';
import { queryClient } from './lib/query';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './components/ui';
import { AppErrorBoundary } from './components/error-boundary';

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // An offline shell is optional; the app still runs online.
      });
    });
  } else {
    // Avoid a production shell worker intercepting the Vite dev server.
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister();
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LangProvider>
          <ToastProvider>
            <AuthProvider>
              <Suspense
                fallback={
                  <div className="flex min-h-screen items-center justify-center bg-bg text-[12px] text-muted">
                    NEXORA
                  </div>
                }
              >
                <AppErrorBoundary>
                  <RouterProvider router={router} />
                </AppErrorBoundary>
              </Suspense>
            </AuthProvider>
          </ToastProvider>
        </LangProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
