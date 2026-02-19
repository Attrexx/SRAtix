'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
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
  loginWithJwt: (jwt: string) => Promise<void>;
  logout: () => void;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem('sratix_token');
    const storedUser = localStorage.getItem('sratix_user');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('sratix_token');
        localStorage.removeItem('sratix_user');
      }
    }
    setIsLoading(false);
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
   */
  const loginWithJwt = useCallback(async (jwt: string) => {
    try {
      // Decode JWT payload (base64url — second segment)
      const parts = jwt.split('.');
      if (parts.length !== 3) throw new Error('Invalid token format');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

      if (!payload.sub || !payload.email) {
        throw new Error('Token missing required fields');
      }

      const userData: User = {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName || payload.email.split('@')[0],
        roles: payload.roles || [],
      };

      localStorage.setItem('sratix_token', jwt);
      localStorage.setItem('sratix_user', JSON.stringify(userData));
      setToken(jwt);
      setUser(userData);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to decode token');
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('sratix_token');
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
