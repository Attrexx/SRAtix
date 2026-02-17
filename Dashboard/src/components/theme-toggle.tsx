'use client';

import { useTheme } from './theme-provider';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const options: Array<{ value: 'light' | 'dark' | 'system'; icon: string; label: string }> = [
    { value: 'light', icon: '☀️', label: 'Light' },
    { value: 'dark', icon: '🌙', label: 'Dark' },
    { value: 'system', icon: '🖥️', label: 'System' },
  ];

  return (
    <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--color-bg-muted)' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          title={opt.label}
          aria-label={`Switch to ${opt.label} mode`}
          className="rounded-md px-2 py-1 text-sm transition-colors"
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
