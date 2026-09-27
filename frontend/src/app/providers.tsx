// src/app/providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from 'next-themes';
import { usePathname } from 'next/navigation';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60 * 1000, retry: 1 },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  // /embed is the public chat widget (rendered inside customer sites via an
  // iframe). The dev-only React Query devtools button floats bottom-right —
  // exactly over the widget launcher — so keep it off that route.
  const pathname = usePathname();
  const isEmbed = pathname?.startsWith('/embed');

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
        <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
      </ThemeProvider>
      {!isEmbed && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}