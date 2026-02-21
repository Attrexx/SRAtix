'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { setApiToken } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (wpToken: string) => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  loginWithJwt: (jwt: string, refreshToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (role: string) => boolean;
}

// ── Server response shape ─────────────────────────────────────────────────────
// Matches ClientAuthResponse from auth.controller.ts
interface ServerAuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

const AuthContext = createContext<AuthContextType | null>(null);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Decode a JWT payload without verification (client-side).
 * Used ONLY as a last-resort fallback when no server exchange is possible.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
}

/**
 * Call POST /api/auth/refresh with credentials: 'include'.
 * The httpOnly sratix_rt cookie is sent automatically if present.
 * Returns the server response or null if no valid cookie session.
 */
async function callRefresh(): Promise<ServerAuthResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Persist user identity in sessionStorage so the UI can render the user's
   * name immediately on page load while the async refresh is in flight.
   * NOTE: No token values are ever written to sessionStorage / localStorage.
   */
  const persistUser = (u: User | null) => {
    if (u) {
      sessionStorage.setItem('sratix_user', JSON.stringify(u));
    } else {
      sessionStorage.removeItem('sratix_user');
    }
  };

  /**
   * Commit a successful auth response: update React state, sync the api module's
   * in-memory token, persist user identity, and schedule the next refresh.
   */
  const applyAuthResponse = useCallback(
    (data: ServerAuthResponse) => {
      setToken(data.accessToken);
      setUser(data.user);
      setApiToken(data.accessToken);
      persistUser(data.user);
      scheduleRefresh(data.expiresIn);
    },
    // scheduleRefresh is stable (defined below); eslint needs this hint
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Schedule a silent token refresh before the access token expires.
   * @param expiresIn  Seconds until the access token expires (from server response).
   */
  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const delay = Math.max(0, (expiresIn - 60) * 1000); // refresh 60 s before expiry
    if (delay <= 0) return;

    refreshTimerRef.current = setTimeout(async () => {
      const data = await callRefresh();
      if (data) {
        setToken(data.accessToken);
        setUser(data.user);
        setApiToken(data.accessToken);
        persistUser(data.user);
        scheduleRefresh(data.expiresIn);
      } else {
        // Cookie expired — clear session
        setToken(null);
        setUser(null);
        setApiToken(null);
        persistUser(null);
      }
    }, delay);
  }, []);

  // Re-bind applyAuthResponse now that scheduleRefresh is stable
  // (useCallback deps need to be declared after scheduleRefresh is defined)
  const stableApply = useCallback(
    (data: ServerAuthResponse) => {
      setToken(data.accessToken);
      setUser(data.user);
      setApiToken(data.accessToken);
      persistUser(data.user);
      scheduleRefresh(data.expiresIn);
    },
    [scheduleRefresh],
  );

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    // Show cached user immediately (eliminates visible "logged-out" flash)
    const storedUser = sessionStorage.getItem('sratix_user');
    if (storedUser) {
      try { setUser(JSON.parse(storedUser)); } catch { /* ignore */ }
    }

    // Attempt to restore session via httpOnly refresh cookie
    callRefresh().then((data) => {
      if (data) {
        stableApply(data);
      } else {
        // No valid cookie session — clear any stale display state
        setToken(null);
        setUser(null);
        setApiToken(null);
        persistUser(null);
      }
    }).finally(() => setIsLoading(false));
  }, [stableApply]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  // ── Auth actions ────────────────────────────────────────────────────────────

  /**
   * Login via WP HMAC bridge token (legacy — calls existing wp-exchange endpoint).
   */
  const login = useCallback(async (wpToken: string) => {
    const res = await fetch(`${API_BASE}/api/auth/wp-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token: wpToken }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message ?? 'Authentication failed');
    }
    stableApply(await res.json());
  }, [stableApply]);

  /**
   * Login with email + password.
   * Server sets the httpOnly refresh cookie; only the access token is returned
   * in the response body and stored in-memory.
   */
  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? 'Authentication failed');
      }
      stableApply(await res.json());
    },
    [stableApply],
  );

  /**
   * Login with a pre-issued JWT from the WP Control plugin redirect.
   *
   * Security flow:
   *   1. If a refresh token is present in the URL (?token=...&refresh=...):
   *      POST /api/auth/init-session { refreshToken } — the server validates
   *      the token, sets the httpOnly refresh cookie, and returns a fresh
   *      access token.  The refresh token is never stored client-side.
   *   2. If only an access token is present (fallback): decode it client-side
   *      and use it directly until it expires (15 min), then the user must
   *      re-authenticate.
   *
   * In both cases the URL params are cleared by the calling code in login/page.tsx
   * immediately after this function returns.
   */
  const loginWithJwt = useCallback(
    async (jwt: string, refreshToken?: string) => {
      if (refreshToken) {
        // Promote refresh token to httpOnly cookie via server round-trip
        const res = await fetch(`${API_BASE}/api/auth/init-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ refreshToken }),
        });
        if (res.ok) {
          stableApply(await res.json());
          return;
        }
        // init-session failed — fall through to JWT-only path
      }

      // Fallback: decode the access JWT client-side (no persistent session)
      const payload = decodeJwtPayload(jwt);
      if (!payload.sub || !payload.email) throw new Error('Token missing required fields');

      const userData: User = {
        id: payload.sub as string,
        email: payload.email as string,
        displayName: (payload.displayName as string) || (payload.email as string).split('@')[0],
        roles: (payload.roles as string[]) || [],
      };
      setToken(jwt);
      setUser(userData);
      setApiToken(jwt);
      persistUser(userData);
      // No scheduleRefresh — no refresh cookie available; token expires in ~15 min
    },
    [stableApply],
  );

  /**
   * Logout: clear the httpOnly refresh cookie server-side and wipe in-memory state.
   */
  const logout = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Ask the server to clear the refresh cookie
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => { /* fire-and-forget */ });
    setToken(null);
    setUser(null);
    setApiToken(null);
    persistUser(null);
  }, []);

  const hasRole = useCallback(
    (role: string) => user?.roles?.includes(role) ?? false,
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, login, loginWithPassword, loginWithJwt, logout, hasRole }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
