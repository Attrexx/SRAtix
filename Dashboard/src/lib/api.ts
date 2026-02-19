/**
 * SRAtix API Client — connects Dashboard to the NestJS Server.
 *
 * Uses fetch API with JWT Bearer token.
 * In development, requests are proxied via Next.js rewrites to localhost:3000.
 * In production, both apps are behind the same domain (tix.swiss-robotics.org).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sratix_token');
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sratix_refresh_token');
}

/** Check if a JWT is expired (with 60s buffer). */
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return true;
    return payload.exp * 1000 < Date.now() + 60_000; // 60s buffer
  } catch {
    return true;
  }
}

/** Flag to prevent concurrent refresh requests. */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns the new access token or null if refresh failed.
 */
async function doRefreshToken(): Promise<string | null> {
  const rt = getRefreshToken();
  if (!rt) return null;

  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });

    if (!res.ok) {
      // Refresh failed — clear stored tokens
      localStorage.removeItem('sratix_token');
      localStorage.removeItem('sratix_refresh_token');
      localStorage.removeItem('sratix_user');
      return null;
    }

    const data: { accessToken: string; refreshToken: string; expiresIn: number } = await res.json();
    localStorage.setItem('sratix_token', data.accessToken);
    localStorage.setItem('sratix_refresh_token', data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

/** Refresh with deduplication — only one refresh request at a time. */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefreshToken().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let token = getToken();

  // If access token is expired, try refreshing before the request
  if (token && isTokenExpired(token)) {
    token = await refreshAccessToken();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  // On 401, try refreshing token and retrying once
  if (res.status === 401 && getRefreshToken()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retry = await fetch(`${API_BASE}/api${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
      if (!retry.ok) {
        const data = await retry.json().catch(() => null);
        throw new ApiError(retry.status, data?.message ?? `HTTP ${retry.status}`, data);
      }
      if (retry.status === 204) return undefined as T;
      return retry.json();
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      data?.message ?? `HTTP ${res.status}`,
      data,
    );
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json();
}

// ─── Type Definitions ───────────────────────────────────────────

export interface Event {
  id: string;
  name: string;
  slug: string;
  orgId: string;
  description?: string;
  venue?: string;
  startDate: string;
  endDate?: string;
  timezone: string;
  currency: string;
  status: string;
  maxCapacity?: number;
  createdAt: string;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  priceCents: number;
  currency: string;
  maxQuantity?: number;
  soldCount: number;
  sortOrder: number;
  active: boolean;
}

export interface Attendee {
  id: string;
  eventId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  eventId: string;
  orderNumber: string;
  attendeeId: string;
  customerEmail?: string;
  customerName?: string;
  totalCents: number;
  currency: string;
  status: string;
  paidAt?: string;
  createdAt: string;
  items: OrderItem[];
}

export interface OrderItem {
  id: string;
  ticketTypeId: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
}

export interface Ticket {
  id: string;
  code: string;
  orderId: string;
  attendeeId: string;
  ticketTypeId: string;
  status: string;
  qrPayload: string;
  createdAt: string;
}

export interface CheckIn {
  id: string;
  ticketId: string;
  eventId: string;
  method: string;
  direction: string;
  deviceId?: string;
  location?: string;
  createdAt: string;
}

export interface PromoCode {
  id: string;
  eventId: string;
  code: string;
  discountType: string;
  discountValue: number;
  usageLimit?: number;
  usedCount: number;
  active: boolean;
  validFrom?: string;
  validTo?: string;
}

export interface DashboardStats {
  totalAttendees: number;
  totalOrders: number;
  totalRevenue: number;
  totalCheckIns: number;
  ticketsSold: number;
  currency: string;
}

export interface WebhookEndpoint {
  id: string;
  orgId: string;
  eventId?: string | null;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed';
  httpStatus?: number | null;
  responseBody?: string | null;
  attempts: number;
  error?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
  };
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  orgId: string | null;
  wpUserId: number | null;
  emailConfirmedAt: string | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleDefinition {
  value: string;
  label: string;
  description: string;
}

export interface SettingValue {
  key: string;
  envVar: string;
  label: string;
  group: string;
  description: string;
  type: string;
  sensitive: boolean;
  required: boolean;
  value: string;
  source: 'database' | 'env' | 'default';
  isSet: boolean;
}

export interface SettingsResponse {
  settings: SettingValue[];
  groups: Record<string, SettingValue[]>;
}

// ─── API Methods ────────────────────────────────────────────────

export const api = {
  // Auth
  login: (token: string) =>
    request<AuthResponse>('/auth/wp-exchange', {
      method: 'POST',
      body: { token },
    }),

  // Events
  getEvents: (signal?: AbortSignal) =>
    request<Event[]>('/events', { signal }),

  getEvent: (id: string, signal?: AbortSignal) =>
    request<Event>(`/events/${id}`, { signal }),

  createEvent: (data: Partial<Event>) =>
    request<Event>('/events', { method: 'POST', body: data }),

  updateEvent: (id: string, data: Partial<Event>) =>
    request<Event>(`/events/${id}`, { method: 'PATCH', body: data }),

  // Ticket Types
  getTicketTypes: (eventId: string, signal?: AbortSignal) =>
    request<TicketType[]>(`/ticket-types/event/${eventId}`, { signal }),

  // Attendees
  getAttendees: (eventId: string, signal?: AbortSignal) =>
    request<Attendee[]>(`/attendees/event/${eventId}`, { signal }),

  // Orders
  getOrders: (eventId: string, signal?: AbortSignal) =>
    request<Order[]>(`/orders/event/${eventId}`, { signal }),

  getOrder: (id: string, signal?: AbortSignal) =>
    request<Order>(`/orders/${id}`, { signal }),

  // Check-Ins
  getCheckInStats: (eventId: string, signal?: AbortSignal) =>
    request<{
      total: number;
      today: number;
      byTicketType: Record<string, number>;
    }>(`/check-ins/stats/event/${eventId}`, { signal }),

  getRecentCheckIns: (eventId: string, limit?: number, signal?: AbortSignal) =>
    request<CheckIn[]>(
      `/check-ins/event/${eventId}${limit ? `?limit=${limit}` : ''}`,
      { signal },
    ),

  // Promo Codes
  getPromoCodes: (eventId: string, signal?: AbortSignal) =>
    request<PromoCode[]>(`/promo-codes/event/${eventId}`, { signal }),

  // Forms
  getFormSchemas: (eventId: string, signal?: AbortSignal) =>
    request<unknown[]>(`/forms/event/${eventId}`, { signal }),

  // Exports
  exportAttendees: (eventId: string) =>
    `${API_BASE}/api/export/attendees/event/${eventId}`,

  exportOrders: (eventId: string) =>
    `${API_BASE}/api/export/orders/event/${eventId}`,

  exportCheckIns: (eventId: string) =>
    `${API_BASE}/api/export/check-ins/event/${eventId}`,

  // Webhooks
  getWebhookEventTypes: (signal?: AbortSignal) =>
    request<{ eventTypes: string[] }>('/webhooks/event-types', { signal }),

  getWebhookEndpoints: (orgId: string, eventId?: string, signal?: AbortSignal) =>
    eventId
      ? request<WebhookEndpoint[]>(`/webhooks/endpoints/${orgId}/${eventId}`, { signal })
      : request<WebhookEndpoint[]>(`/webhooks/endpoints/${orgId}`, { signal }),

  getWebhookEndpoint: (id: string, signal?: AbortSignal) =>
    request<WebhookEndpoint & { deliveries: WebhookDelivery[] }>(`/webhooks/endpoint/${id}`, { signal }),

  createWebhookEndpoint: (data: { orgId: string; eventId?: string; url: string; events: string[] }) =>
    request<WebhookEndpoint>('/webhooks/endpoints', { method: 'POST', body: data }),

  updateWebhookEndpoint: (id: string, data: { url?: string; events?: string[]; active?: boolean }) =>
    request<WebhookEndpoint>(`/webhooks/endpoint/${id}`, { method: 'PATCH', body: data }),

  deleteWebhookEndpoint: (id: string) =>
    request<void>(`/webhooks/endpoint/${id}`, { method: 'DELETE' }),

  rotateWebhookSecret: (id: string) =>
    request<WebhookEndpoint>(`/webhooks/endpoint/${id}/rotate-secret`, { method: 'POST' }),

  getWebhookDeliveries: (endpointId: string, signal?: AbortSignal) =>
    request<WebhookDelivery[]>(`/webhooks/deliveries/${endpointId}`, { signal }),

  retryWebhookDelivery: (id: string) =>
    request<void>(`/webhooks/deliveries/${id}/retry`, { method: 'POST' }),

  // ─── Users (Super Admin) ───────────────────────────────────────

  getUsers: (signal?: AbortSignal) =>
    request<AppUser[]>('/users', { signal }),

  getUser: (id: string, signal?: AbortSignal) =>
    request<AppUser>(`/users/${id}`, { signal }),

  getAvailableRoles: (signal?: AbortSignal) =>
    request<RoleDefinition[]>('/users/roles', { signal }),

  createUser: (data: {
    email: string;
    displayName: string;
    password: string;
    roles: string[];
    orgId?: string;
  }) =>
    request<AppUser>('/users', { method: 'POST', body: data }),

  updateUser: (
    id: string,
    data: {
      email?: string;
      displayName?: string;
      password?: string;
      roles?: string[];
      orgId?: string;
      active?: boolean;
    },
  ) => request<AppUser>(`/users/${id}`, { method: 'PATCH', body: data }),

  deactivateUser: (id: string) =>
    request<{ success: boolean }>(`/users/${id}`, { method: 'DELETE' }),

  activateUser: (id: string) =>
    request<{ success: boolean }>(`/users/${id}/activate`, { method: 'POST' }),

  // ─── Settings (Super Admin) ────────────────────────────────────

  getSettings: (signal?: AbortSignal) =>
    request<SettingsResponse>('/settings', { signal }),

  updateSettings: (settings: Array<{ key: string; value: string }>) =>
    request<{ updated: string[]; requiresRestart: boolean }>('/settings', {
      method: 'PATCH',
      body: { settings },
    }),
};

export { ApiError };
