'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { getApiToken, refreshAccessToken } from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Non-retriable error — stops SSE reconnection. */
class FatalSSEError extends Error {}

/**
 * Hook to subscribe to Server-Sent Events from the SRAtix Server.
 *
 * Uses @microsoft/fetch-event-source so we can send the JWT access token
 * in the Authorization header (native EventSource doesn't support headers).
 *
 * Auth flow:
 *   1. Custom `fetch` reads the latest in-memory token on every request.
 *   2. On 401, it transparently refreshes the token and retries once.
 *   3. If refresh fails (session expired), the error propagates to `onopen`
 *      which throws a FatalSSEError to stop reconnection.
 *   4. Network errors (server down, connectivity lost) auto-retry via the library.
 *
 * Channels:
 *   - events/{eventId}/check-ins — live check-in feed
 *   - events/{eventId}/stats     — capacity, revenue, velocity
 *   - events/{eventId}/orders    — new order notifications
 *   - events/{eventId}/alerts    — system alerts, capacity warnings
 */
export function useSSE<T = unknown>(
  channel: string,
  onMessage: (data: T) => void,
  enabled = true,
) {
  const [isConnected, setIsConnected] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!enabled || !channel) return;

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    const url = `${API_BASE}/api/sse/${channel}`;

    fetchEventSource(url, {
      signal: ctrl.signal,
      openWhenHidden: true,
      credentials: 'include',

      // Inject Authorization header dynamically on every request (including retries).
      // Handles 401 → refresh → retry transparently within a single fetch call.
      async fetch(input, init) {
        const headers = { ...(init?.headers as Record<string, string>) };
        const token = getApiToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let response = await window.fetch(input, { ...init, headers });

        if (response.status === 401) {
          const newToken = await refreshAccessToken();
          if (newToken) {
            headers['Authorization'] = `Bearer ${newToken}`;
            response = await window.fetch(input, { ...init, headers });
          }
        }

        return response;
      },

      async onopen(response) {
        if (response.ok) {
          setIsConnected(true);
          return;
        }
        // Custom fetch already tried refresh — any HTTP error is non-retriable
        throw new FatalSSEError(`SSE open failed: ${response.status}`);
      },

      onmessage(event) {
        if (!event.data) return;
        try {
          const data = JSON.parse(event.data) as T;
          onMessageRef.current(data);
        } catch {
          // heartbeat or non-JSON message — ignore
        }
      },

      onclose() {
        setIsConnected(false);
      },

      onerror(err) {
        setIsConnected(false);
        if (ctrl.signal.aborted) throw err;
        if (err instanceof FatalSSEError) throw err;
        // Network error — return void to let the library auto-retry
      },
    });

    return () => {
      ctrl.abort();
      setIsConnected(false);
    };
  }, [channel, enabled]);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  return { isConnected };
}

/**
 * Hook that accumulates SSE events into a buffer (e.g., for live feeds).
 * Keeps the last `maxItems` items.
 */
export function useSSEBuffer<T = unknown>(
  channel: string,
  maxItems = 50,
  enabled = true,
) {
  const [items, setItems] = useState<T[]>([]);

  const handleMessage = useCallback(
    (data: T) => {
      setItems((prev) => [data, ...prev].slice(0, maxItems));
    },
    [maxItems],
  );

  const { isConnected } = useSSE<T>(channel, handleMessage, enabled);

  const clear = useCallback(() => setItems([]), []);

  return { items, isConnected, clear };
}
