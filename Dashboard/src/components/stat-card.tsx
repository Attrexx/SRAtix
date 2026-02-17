interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  trend?: string;
  trendUp?: boolean;
  className?: string;
}

export function StatCard({ label, value, icon, trend, trendUp, className = '' }: StatCardProps) {
  return (
    <div
      className={`rounded-xl p-5 ${className}`}
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {value}
          </p>
          {trend && (
            <p
              className="mt-1 text-xs font-medium"
              style={{ color: trendUp ? 'var(--color-success)' : 'var(--color-danger)' }}
            >
              {trendUp ? '↑' : '↓'} {trend}
            </p>
          )}
        </div>
        {icon && <span className="text-2xl opacity-50">{icon}</span>}
      </div>
    </div>
  );
}
