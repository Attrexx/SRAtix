'use client';

import { type ReactNode } from 'react';
import { useTheme } from './theme-provider';
import { Icons } from './icons';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const options: Array<{ value: 'light' | 'dark' | 'system'; icon: ReactNode; label: string }> = [
    { value: 'light', icon: <Icons.Sun size={14} />, label: 'Light' },
    { value: 'dark', icon: <Icons.Moon size={14} />, label: 'Dark' },
    { value: 'system', icon: <Icons.Monitor size={14} />, label: 'System' },
  ];

  return (
    <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--color-bg-muted)' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          title={opt.label}
          aria-label={`Switch to ${opt.label} mode`}
          className="flex items-center justify-center rounded-md px-2 py-1.5 transition-colors"
          style={{
            background: theme === opt.value ? 'var(--color-bg-card)' : 'transparent',
            boxShadow: theme === opt.value ? 'var(--shadow-sm)' : 'none',
            color: 'var(--color-text)',
          }}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
