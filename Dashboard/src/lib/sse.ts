'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Hook to subscribe to Server-Sent Events from the SRAtix Server.
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!enabled || !channel) return;

    const token = localStorage.getItem('sratix_token');
    const url = `${API_BASE}/api/sse/${channel}${token ? `?token=${token}` : ''}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as T;
        onMessageRef.current(data);
      } catch {
        // heartbeat or non-JSON message — ignore
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects by default
    };

    return () => {
      es.close();
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
