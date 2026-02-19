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
import { api, type AuthResponse } from './api';

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
  loginWithJwt: (jwt: string, refreshToken?: string) => Promise<void>;
  logout: () => void;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Decode a JWT payload without verification (client-side). */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
}

/** Check if a JWT is expired (with 2-minute buffer). */
function isExpired(jwt: string): boolean {
  try {
    const payload = decodeJwtPayload(jwt);
    const exp = payload.exp as number;
    if (!exp) return true;
    return exp * 1000 < Date.now() + 120_000;
  } catch {
    return true;
  }
}

/** Time in ms until token expires (minus 2 min buffer). Returns 0 if already expired. */
function msUntilExpiry(jwt: string): number {
  try {
    const payload = decodeJwtPayload(jwt);
    const exp = payload.exp as number;
    if (!exp) return 0;
    const ms = exp * 1000 - Date.now() - 120_000;
    return Math.max(0, ms);
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Schedule a silent token refresh before expiry. */
  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const delay = msUntilExpiry(accessToken);
    if (delay <= 0) return; // already expired

    refreshTimerRef.current = setTimeout(async () => {
      const rt = localStorage.getItem('sratix_refresh_token');
      if (!rt) return;

      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/auth/refresh`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: rt }),
          },
        );

        if (!res.ok) throw new Error('Refresh failed');

        const data: { accessToken: string; refreshToken: string; expiresIn: number } =
          await res.json();

        localStorage.setItem('sratix_token', data.accessToken);
        localStorage.setItem('sratix_refresh_token', data.refreshToken);
        setToken(data.accessToken);

        // Decode and update user from fresh token
        const payload = decodeJwtPayload(data.accessToken);
        const freshUser: User = {
          id: payload.sub as string,
          email: payload.email as string,
          displayName: (payload.displayName as string) || (payload.email as string).split('@')[0],
          roles: (payload.roles as string[]) || [],
        };
        localStorage.setItem('sratix_user', JSON.stringify(freshUser));
        setUser(freshUser);

        // Schedule next refresh
        scheduleRefresh(data.accessToken);
      } catch {
        // Refresh failed — clear session
        localStorage.removeItem('sratix_token');
        localStorage.removeItem('sratix_refresh_token');
        localStorage.removeItem('sratix_user');
        setToken(null);
        setUser(null);
      }
    }, delay);
  }, []);

  // Restore session from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem('sratix_token');
    const storedUser = localStorage.getItem('sratix_user');
    const storedRefresh = localStorage.getItem('sratix_refresh_token');

    if (storedToken && storedUser) {
      try {
        if (!isExpired(storedToken)) {
          // Token still valid — restore session
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
          scheduleRefresh(storedToken);
        } else if (storedRefresh) {
          // Token expired but we have a refresh token — refresh immediately
          fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: storedRefresh }),
          })
            .then((res) => {
              if (!res.ok) throw new Error('Refresh failed');
              return res.json();
            })
            .then(
              (data: { accessToken: string; refreshToken: string; expiresIn: number }) => {
                localStorage.setItem('sratix_token', data.accessToken);
                localStorage.setItem('sratix_refresh_token', data.refreshToken);
                setToken(data.accessToken);

                const payload = decodeJwtPayload(data.accessToken);
                const freshUser: User = {
                  id: payload.sub as string,
                  email: payload.email as string,
                  displayName:
                    (payload.displayName as string) || (payload.email as string).split('@')[0],
                  roles: (payload.roles as string[]) || [],
                };
                localStorage.setItem('sratix_user', JSON.stringify(freshUser));
                setUser(freshUser);
                scheduleRefresh(data.accessToken);
              },
            )
            .catch(() => {
              localStorage.removeItem('sratix_token');
              localStorage.removeItem('sratix_refresh_token');
              localStorage.removeItem('sratix_user');
            })
            .finally(() => setIsLoading(false));
          return; // Don't setIsLoading(false) until refresh completes
        } else {
          // Expired and no refresh token — clear
          localStorage.removeItem('sratix_token');
          localStorage.removeItem('sratix_user');
        }
      } catch {
        localStorage.removeItem('sratix_token');
        localStorage.removeItem('sratix_refresh_token');
        localStorage.removeItem('sratix_user');
      }
    }
    setIsLoading(false);
  }, [scheduleRefresh]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const login = useCallback(async (wpToken: string) => {
    const res: AuthResponse = await api.login(wpToken);
    localStorage.setItem('sratix_token', res.access_token);
    localStorage.setItem('sratix_user', JSON.stringify(res.user));
    setToken(res.access_token);
    setUser(res.user);
  }, []);

  /**
   * Login with a pre-issued JWT (from WP Control plugin redirect).
   * Decodes the JWT payload to extract user data — no server round-trip needed.
   * Optionally stores a refresh token for session persistence.
   */
  const loginWithJwt = useCallback(
    async (jwt: string, refreshToken?: string) => {
      try {
        const payload = decodeJwtPayload(jwt);

        if (!payload.sub || !payload.email) {
          throw new Error('Token missing required fields');
        }

        const userData: User = {
          id: payload.sub as string,
          email: payload.email as string,
          displayName:
            (payload.displayName as string) || (payload.email as string).split('@')[0],
          roles: (payload.roles as string[]) || [],
        };

        localStorage.setItem('sratix_token', jwt);
        localStorage.setItem('sratix_user', JSON.stringify(userData));
        if (refreshToken) {
          localStorage.setItem('sratix_refresh_token', refreshToken);
        }
        setToken(jwt);
        setUser(userData);

        // Schedule automatic refresh
        scheduleRefresh(jwt);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : 'Failed to decode token');
      }
    },
    [scheduleRefresh],
  );

  const logout = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    localStorage.removeItem('sratix_token');
    localStorage.removeItem('sratix_refresh_token');
    localStorage.removeItem('sratix_user');
    setToken(null);
    setUser(null);
  }, []);

  const hasRole = useCallback(
    (role: string) => user?.roles?.includes(role) ?? false,
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, login, loginWithJwt, logout, hasRole }}
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
