'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from './theme-toggle';
import { Icons } from './icons';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  roles?: string[];
}

function getEventNav(eventId: string): NavItem[] {
  return [
    { href: `/dashboard/events/${eventId}`, label: 'Overview', icon: <Icons.BarChart size={18} /> },
    { href: `/dashboard/events/${eventId}/ticket-types`, label: 'Ticket Types', icon: <Icons.Ticket size={18} /> },
    { href: `/dashboard/events/${eventId}/attendees`, label: 'Attendees', icon: <Icons.Users size={18} /> },
    { href: `/dashboard/events/${eventId}/orders`, label: 'Orders', icon: <Icons.ShoppingCart size={18} /> },
    { href: `/dashboard/events/${eventId}/check-in`, label: 'Check-In Live', icon: <Icons.CheckCircle size={18} /> },
    { href: `/dashboard/events/${eventId}/analytics`, label: 'Analytics', icon: <Icons.TrendingUp size={18} /> },
    { href: `/dashboard/events/${eventId}/promo-codes`, label: 'Promo Codes', icon: <Icons.Tag size={18} /> },
    { href: `/dashboard/events/${eventId}/forms`, label: 'Forms', icon: <Icons.Clipboard size={18} /> },
    { href: `/dashboard/events/${eventId}/audit-log`, label: 'Activity Log', icon: <Icons.FileText size={18} /> },
    { href: `/dashboard/events/${eventId}/export`, label: 'Export', icon: <Icons.Upload size={18} /> },
    { href: `/dashboard/events/${eventId}/webhooks`, label: 'Webhooks', icon: <Icons.Link size={18} />, roles: ['admin', 'owner'] },
  ];
}

const topNav: NavItem[] = [
  { href: '/dashboard', label: 'Events', icon: <Icons.Calendar size={18} /> },
  { href: '/dashboard/users', label: 'Users', icon: <Icons.User size={18} />, roles: ['super_admin'] },
  { href: '/dashboard/settings', label: 'Settings', icon: <Icons.Settings size={18} />, roles: ['super_admin'] },
];

export function Sidebar({ eventId }: { eventId?: string }) {
  const pathname = usePathname();
  const { user, logout, hasRole } = useAuth();

  const eventNav = eventId ? getEventNav(eventId) : [];

  return (
    <aside
      className="flex h-screen w-64 flex-col"
      style={{
        background: 'var(--color-sidebar)',
        color: 'var(--color-sidebar-text)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center px-5 py-4">
        <img
          src="/logo.png"
          alt="SRAtix"
          className="h-9 w-auto"
          draggable={false}
        />
      </div>

      {/* Top Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest opacity-40">
          Platform
        </p>
        {topNav
          .filter((item) => !item.roles || item.roles.some((r) => hasRole(r)))
          .map((item) => (
            <SidebarLink key={item.href} item={item} active={pathname === item.href} />
          ))}

        {/* Event-Scoped Navigation */}
        {eventId && eventNav.length > 0 && (
          <>
            <div className="my-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }} />
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest opacity-40">
              Event
            </p>
            {eventNav.map((item) => (
              <SidebarLink key={item.href} item={item} active={pathname === item.href} />
            ))}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="mb-3 flex items-center justify-between">
          <ThemeToggle />
        </div>
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {user.displayName}
              </p>
              <p className="truncate text-xs opacity-50">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="ml-2 rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
              aria-label="Sign out"
            >
              <Icons.LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  // Use native <a> for event sub-pages to force full page load →
  // SPA fallback serves the _ placeholder HTML with correct URL
  // so useEventId() can read the real UUID from window.location.
  const isEventRoute = item.href.includes('/dashboard/events/');
  const Tag = isEventRoute ? 'a' : Link;

  return (
    <Tag
      href={item.href}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
      style={{
        background: active ? 'var(--color-sidebar-active)' : 'transparent',
        color: active ? '#fff' : 'var(--color-sidebar-text)',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--color-sidebar-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span className="flex-shrink-0">{item.icon}</span>
      <span>{item.label}</span>
    </Tag>
  );
}
