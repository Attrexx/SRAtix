import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/lib/auth';
import { I18nProvider } from '@/i18n/i18n-provider';
import { RebuildBanner } from '@/components/rebuild-banner';
import './globals.css';

export const metadata: Metadata = {
  title: 'SRAtix — Event Management Dashboard',
  description: 'Swiss Robotics Association ticketing & event management platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <RebuildBanner />
              {children}
            </AuthProvider>
          </I18nProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
