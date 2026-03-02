/**
 * Small "TEST" chip displayed next to orders, tickets, or attendees
 * that were created while SRAtix was in Stripe test mode.
 */
export function TestBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${className}`}
      style={{
        background: 'var(--color-warning-light, rgba(234,179,8,0.15))',
        color: 'var(--color-warning, #ca8a04)',
        border: '1px solid var(--color-warning, #ca8a04)',
        lineHeight: 1,
      }}
      title="Created in test mode"
    >
      TEST
    </span>
  );
}
