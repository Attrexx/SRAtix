interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusStyles: Record<string, { bg: string; text: string }> = {
  active: { bg: 'var(--color-success-light)', text: 'var(--color-success)' },
  paid: { bg: 'var(--color-success-light)', text: 'var(--color-success)' },
  valid: { bg: 'var(--color-success-light)', text: 'var(--color-success)' },
  checked_in: { bg: 'var(--color-success-light)', text: 'var(--color-success)' },
  pending: { bg: 'var(--color-warning-light)', text: 'var(--color-warning)' },
  draft: { bg: 'var(--color-warning-light)', text: 'var(--color-warning)' },
  expired: { bg: 'var(--color-danger-light)', text: 'var(--color-danger)' },
  refunded: { bg: 'var(--color-danger-light)', text: 'var(--color-danger)' },
  voided: { bg: 'var(--color-danger-light)', text: 'var(--color-danger)' },
  cancelled: { bg: 'var(--color-danger-light)', text: 'var(--color-danger)' },
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const style = statusStyles[status] ?? {
    bg: 'var(--color-bg-muted)',
    text: 'var(--color-text-secondary)',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
      style={{ background: style.bg, color: style.text }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
