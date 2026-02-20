'use client';

import { type ReactNode, useState, useEffect, useCallback } from 'react';
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
  const [mobileOpen, setMobileOpen] = useState(false);

  const eventNav = eventId ? getEventNav(eventId) : [];

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close drawer on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center px-5 py-5">
        <img
          src="/logo.png"
          alt="SRAtix"
          className="h-12 w-auto"
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
    </>
  );

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div
        className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 px-4 md:hidden"
        style={{
          background: 'var(--color-sidebar)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/10"
          aria-label="Open menu"
        >
          <Icons.BarChart size={22} className="hidden" />
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <img src="/logo.png" alt="SRAtix" className="h-7 w-auto" draggable={false} />
      </div>

      {/* ── Mobile drawer overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />
          {/* Drawer */}
          <aside
            className="relative flex h-full w-72 flex-col"
            style={{
              background: 'var(--color-sidebar)',
              color: 'var(--color-sidebar-text)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <Icons.X size={20} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <aside
        className="hidden md:flex h-screen w-64 flex-col flex-shrink-0"
        style={{
          background: 'var(--color-sidebar)',
          color: 'var(--color-sidebar-text)',
        }}
      >
        {sidebarContent}
      </aside>
    </>
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
