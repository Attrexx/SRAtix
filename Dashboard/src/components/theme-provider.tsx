'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = localStorage.getItem('sratix_theme') as Theme | null;
    if (stored) setThemeState(stored);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const resolve = () => {
      const r =
        theme === 'system'
          ? mediaQuery.matches
            ? 'dark'
            : 'light'
          : theme;
      setResolved(r);
      document.documentElement.classList.toggle('dark', r === 'dark');
    };

    resolve();
    mediaQuery.addEventListener('change', resolve);
    return () => mediaQuery.removeEventListener('change', resolve);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem('sratix_theme', t);
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
