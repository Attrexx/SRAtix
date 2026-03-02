/**
 * SRAtix API Client — connects Dashboard to the NestJS Server.
 *
 * Security model:
 *   - Access token: stored in-memory only (module-level variable + React state in auth.tsx).
 *     Never written to localStorage or sessionStorage.
 *   - Refresh token: stored as httpOnly cookie (set by server on login/refresh).
 *     The browser sends it automatically via credentials: 'include'.
 *   - All fetch() calls include credentials: 'include' so the refresh cookie travels
 *     with every request to the same origin.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

// ── In-memory token store ─────────────────────────────────────────────────────
// auth.tsx calls setApiToken() after every successful login / refresh.
// This module never reads from localStorage.
let _apiToken: string | null = null;

/** Update the in-memory access token.  Called by AuthProvider. */
export function setApiToken(t: string | null): void {
  _apiToken = t;
}

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
  return _apiToken;
}

/** Flag to prevent concurrent refresh requests. */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the httpOnly sratix_rt cookie.
 * The cookie is sent automatically by the browser (credentials: 'include').
 * Returns the new access token or null if no valid cookie session.
 */
async function doRefreshToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // No body — the refresh token is in the httpOnly sratix_rt cookie
    });

    if (!res.ok) {
      _apiToken = null;
      return null;
    }

    const data: { accessToken: string; expiresIn: number } = await res.json();
    _apiToken = data.accessToken;
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

  // If no access token is in memory, try refreshing before the request
  if (!token) {
    token = await refreshAccessToken();
  }

  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
    credentials: 'include',
  });

  // On 401, try refreshing token and retrying once
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retry = await fetch(`${API_BASE}/api${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
        credentials: 'include',
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

/**
 * Authenticated file download — fetches a URL with the Bearer token
 * and triggers a browser download from the resulting blob.
 * Used for export endpoints that require JWT auth.
 */
export async function downloadFile(url: string, fallbackFilename: string): Promise<void> {
  let token = getToken();
  if (!token) {
    token = await refreshAccessToken();
  }

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(url, { headers, credentials: 'include' });

  // Retry once on 401 after refreshing the token
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(url, { headers, credentials: 'include' });
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.message ?? `HTTP ${res.status}`, data);
  }

  const blob = await res.blob();

  // Extract filename from Content-Disposition header if available
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="?([^";\n]+)"?/);
  const filename = match?.[1] ?? fallbackFilename;

  // Trigger browser download
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Clean up
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 100);
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

export interface PricingVariant {
  id: string;
  ticketTypeId: string;
  variantType: string;  // early_bird | full_price | membership
  label: string;
  priceCents: number;
  validFrom?: string | null;
  validUntil?: string | null;
  wpProductId?: number | null;
  membershipTier?: string | null;
  sortOrder: number;
  active: boolean;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  priceCents: number;
  currency: string;
  quantity?: number | null;
  sold: number;
  maxPerOrder: number;
  salesStart?: string | null;
  salesEnd?: string | null;
  status: string;
  sortOrder: number;
  formSchemaId?: string | null;
  category?: string;
  membershipTier?: string | null;
  wpProductId?: number | null;
  meta?: Record<string, unknown> | null;
  pricingVariants?: PricingVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketTypeMeta {
  categories: readonly string[];
  tiers: readonly string[];
  tierLabels: Record<string, string>;
  tierCategoryMap: Record<string, string>;
  tierWpProductMap: Record<string, number>;
}

export interface FormTemplate {
  id: string;
  orgId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  fields: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface FormSchema {
  id: string;
  eventId: string;
  name: string;
  version: number;
  active: boolean;
  ticketTypeId?: string;
  fields: unknown;
  createdAt: string;
  updatedAt: string;
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
  meta?: Record<string, unknown> | null;
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
  meta?: Record<string, unknown> | null;
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
  description?: string;
  discountType: string;
  discountValue: number;
  currency: string;
  usageLimit?: number | null;
  usedCount: number;
  perCustomerLimit: number;
  validFrom?: string | null;
  validTo?: string | null;
  applicableTicketIds?: string[] | null;
  minOrderCents?: number | null;
  active: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  eventId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  timestamp: string;
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
  options?: string[];
}

export interface SettingsResponse {
  settings: SettingValue[];
  groups: Record<string, SettingValue[]>;
}

export interface TimeSeriesPoint {
  date: string;
  sales: number;
  registrations: number;
  memberships: number;
  pageViews: number;
}

export interface TimeSeriesResponse {
  series: TimeSeriesPoint[];
  range: { from: string; to: string };
  firstSaleDate: string | null;
}

export interface FieldDefinition {
  id: string;
  slug: string;
  label: Record<string, string>;       // i18n: { en, fr, de, it, 'zh-TW' }
  type: string;
  group: string;                        // must_have | billing | legal_compliance | profile | company | b2b | privacy | questions | community
  options?: Array<{ value: string; label: Record<string, string> }>;
  defaultWidthDesktop: number;          // 25 | 33 | 50 | 75 | 100
  defaultWidthMobile: number;
  validationRules?: Record<string, unknown>;
  helpText?: Record<string, string>;
  placeholder?: Record<string, string>;
  defaultValue?: unknown;
  categoryFilter?: string[];
  conditionalOn?: Record<string, unknown>;
  sortOrder: number;
  isSystem: boolean;
  active: boolean;
}

// ─── API Methods ────────────────────────────────────────────────
// Note: auth flows (login, logout, refresh) are handled directly in
// Dashboard/src/lib/auth.tsx via fetch() with credentials: 'include'.
// The api object covers all authenticated resource endpoints only.

export const api = {
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
    request<TicketType[]>(`/events/${eventId}/ticket-types`, { signal }),

  getTicketTypeMeta: (eventId: string, signal?: AbortSignal) =>
    request<TicketTypeMeta>(`/events/${eventId}/ticket-types/meta`, { signal }),

  createTicketType: (eventId: string, data: {
    name: string;
    description?: string;
    priceCents: number;
    currency: string;
    capacity?: number;
    salesStart?: string;
    salesEnd?: string;
    sortOrder?: number;
    category?: string;
    membershipTier?: string;
    wpProductId?: number;
    formSchemaId?: string;
  }) =>
    request<TicketType>(`/events/${eventId}/ticket-types`, { method: 'POST', body: data }),

  updateTicketType: (eventId: string, id: string, data: Record<string, unknown>) =>
    request<TicketType>(`/events/${eventId}/ticket-types/${id}`, { method: 'PATCH', body: data }),

  deleteTicketType: (eventId: string, id: string) =>
    request<void>(`/events/${eventId}/ticket-types/${id}`, { method: 'DELETE' }),

  // Pricing Variants
  getVariants: (eventId: string, ticketTypeId: string, signal?: AbortSignal) =>
    request<PricingVariant[]>(`/events/${eventId}/ticket-types/${ticketTypeId}/variants`, { signal }),

  createVariant: (eventId: string, ticketTypeId: string, data: {
    variantType: string;
    label: string;
    priceCents: number;
    validFrom?: string;
    validUntil?: string;
    wpProductId?: number;
    membershipTier?: string;
    sortOrder?: number;
  }) =>
    request<PricingVariant>(`/events/${eventId}/ticket-types/${ticketTypeId}/variants`, { method: 'POST', body: data }),

  updateVariant: (eventId: string, ticketTypeId: string, variantId: string, data: Record<string, unknown>) =>
    request<PricingVariant>(`/events/${eventId}/ticket-types/${ticketTypeId}/variants/${variantId}`, { method: 'PATCH', body: data }),

  deleteVariant: (eventId: string, ticketTypeId: string, variantId: string) =>
    request<void>(`/events/${eventId}/ticket-types/${ticketTypeId}/variants/${variantId}`, { method: 'DELETE' }),

  // Attendees
  getAttendees: (eventId: string, signal?: AbortSignal) =>
    request<Attendee[]>(`/attendees/event/${eventId}`, { signal }),

  createAttendee: (data: {
    eventId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    company?: string;
  }) =>
    request<Attendee>('/attendees', { method: 'POST', body: data }),

  updateAttendee: (id: string, data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    company?: string;
  }) =>
    request<Attendee>(`/attendees/${id}`, { method: 'PATCH', body: data }),

  // Orders
  getOrders: (eventId: string, signal?: AbortSignal) =>
    request<Order[]>(`/orders/event/${eventId}`, { signal }),

  getOrder: (id: string, signal?: AbortSignal) =>
    request<Order>(`/orders/${id}`, { signal }),

  // Check-Ins
  // Server returns { totalTickets, checkedIn, totalCheckIns, percentCheckedIn }
  // Dashboard expects { total, today, byTicketType } — map here
  getCheckInStats: async (eventId: string, signal?: AbortSignal): Promise<{
    total: number;
    today: number;
    byTicketType: Record<string, number>;
  }> => {
    const raw = await request<{
      totalTickets?: number;
      checkedIn?: number;
      totalCheckIns?: number;
      percentCheckedIn?: number;
      // forward-compat if server is later extended
      total?: number;
      today?: number;
      byTicketType?: Record<string, number>;
    }>(`/events/${eventId}/check-ins/stats`, { signal });
    return {
      total: raw.total ?? raw.checkedIn ?? raw.totalCheckIns ?? 0,
      today: raw.today ?? 0,
      byTicketType: raw.byTicketType ?? {},
    };
  },

  getRecentCheckIns: (eventId: string, limit?: number, signal?: AbortSignal) =>
    request<CheckIn[]>(
      `/events/${eventId}/check-ins${limit ? `?limit=${limit}` : ''}`,
      { signal },
    ),

  // Promo Codes
  getPromoCodes: (eventId: string, signal?: AbortSignal) =>
    request<PromoCode[]>(`/promo-codes/event/${eventId}`, { signal }),

  createPromoCode: (data: {
    eventId: string;
    code: string;
    description?: string;
    discountType: 'percentage' | 'fixed_amount';
    discountValue: number;
    currency?: string;
    usageLimit?: number;
    perCustomerLimit?: number;
    validFrom?: string;
    validTo?: string;
    applicableTicketIds?: string[];
    minOrderCents?: number;
  }) =>
    request<PromoCode>('/promo-codes', { method: 'POST', body: data }),

  updatePromoCode: (id: string, eventId: string, data: Record<string, unknown>) =>
    request<PromoCode>(`/promo-codes/${id}/event/${eventId}`, { method: 'PATCH', body: data }),

  deactivatePromoCode: (id: string, eventId: string) =>
    request<PromoCode>(`/promo-codes/${id}/event/${eventId}/deactivate`, { method: 'PATCH' }),

  // Forms
  getFormSchemas: (eventId: string, signal?: AbortSignal) =>
    request<FormSchema[]>(`/forms/event/${eventId}`, { signal }),

  createFormSchema: (data: {
    eventId: string;
    name: string;
    fields: {
      fields: Array<{
        id: string;
        type: string;
        label: Record<string, string>;
        required?: boolean;
        width?: number;
        options?: Array<{ value: string; label: Record<string, string> }>;
      }>;
    };
  }) =>
    request<FormSchema>('/forms', { method: 'POST', body: data }),

  updateFormSchema: (id: string, eventId: string, data: { name?: string; fields?: unknown }) =>
    request<FormSchema>(`/forms/${id}/event/${eventId}`, { method: 'PATCH', body: data }),

  deleteFormSchema: (id: string, eventId: string) =>
    request<void>(`/forms/${id}/event/${eventId}`, { method: 'DELETE' }),

  // Form Templates
  getFormTemplates: (orgId: string, category?: string, signal?: AbortSignal) =>
    request<FormTemplate[]>(
      `/orgs/${orgId}/form-templates${category ? `?category=${category}` : ''}`,
      { signal },
    ),

  seedFormTemplates: (orgId: string, force = false) =>
    request<{ created: string[]; skipped: string[]; updated: string[] }>(
      `/orgs/${orgId}/form-templates/seed`,
      { method: 'POST', body: { force } },
    ),

  // Field Repository
  getFieldRepository: (signal?: AbortSignal) =>
    request<FieldDefinition[]>('/field-repository', { signal }),

  getFieldRepositoryGroups: (signal?: AbortSignal) =>
    request<string[]>('/field-repository/groups', { signal }),

  // Exports (CSV)
  exportAttendees: (eventId: string) =>
    `${API_BASE}/api/export/attendees/event/${eventId}`,

  exportOrders: (eventId: string) =>
    `${API_BASE}/api/export/orders/event/${eventId}`,

  exportCheckIns: (eventId: string) =>
    `${API_BASE}/api/export/check-ins/event/${eventId}`,

  exportFormSubmissions: (eventId: string, formSchemaId?: string) =>
    `${API_BASE}/api/export/submissions/event/${eventId}${formSchemaId ? `?formSchemaId=${formSchemaId}` : ''}`,

  // Exports (Excel/xlsx)
  exportAttendeesXlsx: (eventId: string) =>
    `${API_BASE}/api/export/attendees/event/${eventId}/xlsx`,

  exportOrdersXlsx: (eventId: string) =>
    `${API_BASE}/api/export/orders/event/${eventId}/xlsx`,

  exportCheckInsXlsx: (eventId: string) =>
    `${API_BASE}/api/export/check-ins/event/${eventId}/xlsx`,

  exportFormSubmissionsXlsx: (eventId: string, formSchemaId?: string) =>
    `${API_BASE}/api/export/submissions/event/${eventId}/xlsx${formSchemaId ? `?formSchemaId=${formSchemaId}` : ''}`,

  // Audit Log
  getAuditLog: (eventId: string, options?: { take?: number; skip?: number; action?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (options?.take) params.set('take', String(options.take));
    if (options?.skip) params.set('skip', String(options.skip));
    if (options?.action) params.set('action', String(options.action));
    const qs = params.toString();
    return request<AuditLogEntry[]>(`/audit-log/event/${eventId}${qs ? `?${qs}` : ''}`, { signal });
  },

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

  // ─── Analytics ─────────────────────────────────────────────────

  getTimeSeries: (
    eventId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ) =>
    request<TimeSeriesResponse>(
      `/analytics/${eventId}/timeseries?from=${from}&to=${to}`,
      { signal },
    ),
};

export { ApiError };
