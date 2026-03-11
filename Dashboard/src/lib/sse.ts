'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { getApiToken, refreshAccessToken } from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Hook to subscribe to Server-Sent Events from the SRAtix Server.
 *
 * Uses @microsoft/fetch-event-source so we can send the JWT access token
 * in the Authorization header (native EventSource doesn't support headers).
 *
 * On 401 the hook automatically refreshes the token and retries.
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

      async onopen(response) {
        if (response.ok) {
          setIsConnected(true);
          return;
        }
        // Non-retriable open errors (e.g. 403) — stop retrying
        if (response.status !== 401) {
          throw new Error(`SSE open failed: ${response.status}`);
        }
        // 401 is handled by onerror → refresh → retry
        throw new Error('Unauthorized');
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

      async onerror(err) {
        setIsConnected(false);

        // If aborted intentionally (cleanup), stop retrying
        if (ctrl.signal.aborted) throw err;

        // Try to refresh the access token before retrying
        const newToken = await refreshAccessToken();
        if (!newToken) {
          // Refresh failed — session expired, stop retrying
          throw err;
        }
        // Return void to let fetch-event-source retry with new headers
      },

      headers: () => {
        const token = getApiToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },

      credentials: 'include',
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
