'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type WebhookEndpoint, type WebhookDelivery } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';

const ALL_EVENT_TYPES = [
  'order.paid',
  'order.refunded',
  'ticket.issued',
  'ticket.voided',
  'checkin.created',
  'attendee.registered',
  'event.updated',
];

export default function WebhooksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [eventId, setEventId] = useState('');
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<
    (WebhookEndpoint & { deliveries: WebhookDelivery[] }) | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showSecret, setShowSecret] = useState<string | null>(null);

  // Form state
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    params.then((p) => setEventId(p.id));
  }, [params]);

  const loadEndpoints = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      // We need orgId — for now we fetch event then use its orgId
      const event = await api.getEvent(eventId);
      const data = await api.getWebhookEndpoints(
        event.orgId,
        eventId,
      );
      setEndpoints(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadEndpoints();
  }, [loadEndpoints]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!newUrl.trim()) {
      setFormError('URL is required');
      return;
    }
    if (newEvents.length === 0) {
      setFormError('Select at least one event type');
      return;
    }
    try {
      const event = await api.getEvent(eventId);
      await api.createWebhookEndpoint({
        orgId: event.orgId,
        eventId,
        url: newUrl.trim(),
        events: newEvents,
      });
      setNewUrl('');
      setNewEvents([]);
      setShowCreate(false);
      loadEndpoints();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create endpoint');
    }
  };

  const handleToggleActive = async (ep: WebhookEndpoint) => {
    await api.updateWebhookEndpoint(ep.id, { active: !ep.active });
    loadEndpoints();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook endpoint? This cannot be undone.')) return;
    await api.deleteWebhookEndpoint(id);
    if (selectedEndpoint?.id === id) setSelectedEndpoint(null);
    loadEndpoints();
  };

  const handleRotateSecret = async (id: string) => {
    if (!confirm('Rotate signing secret? The old secret will stop working immediately.')) return;
    const updated = await api.rotateWebhookSecret(id);
    setShowSecret(updated.secret);
    loadEndpoints();
  };

  const handleViewDeliveries = async (ep: WebhookEndpoint) => {
    const detail = await api.getWebhookEndpoint(ep.id);
    setSelectedEndpoint(detail);
  };

  const handleRetry = async (deliveryId: string) => {
    await api.retryWebhookDelivery(deliveryId);
    if (selectedEndpoint) {
      handleViewDeliveries(selectedEndpoint);
    }
  };

  const toggleEventType = (type: string) => {
    setNewEvents((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type],
    );
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-8 w-48 rounded bg-gray-200 animate-pulse mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Outgoing Webhooks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Notify external services when events occur (orders, check-ins, tickets).
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          {showCreate ? 'Cancel' : '+ Add Endpoint'}
        </button>
      </div>

      {/* Secret reveal banner */}
      {showSecret && (
        <div
          className="rounded-lg p-4 text-sm"
          style={{ background: 'var(--color-success-bg, #f0fdf4)', border: '1px solid var(--color-success, #22c55e)' }}
        >
          <p className="font-semibold mb-1">New Signing Secret (save this now — it won't be shown again):</p>
          <code className="block p-2 rounded font-mono text-xs break-all" style={{ background: 'var(--color-bg)' }}>
            {showSecret}
          </code>
          <button
            onClick={() => setShowSecret(null)}
            className="mt-2 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg p-5 space-y-4"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
        >
          <h3 className="font-semibold text-lg" style={{ color: 'var(--color-text)' }}>
            New Webhook Endpoint
          </h3>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Payload URL
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-site.com/wp-json/sratix/v1/webhook"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>
              Events to subscribe
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_EVENT_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer"
                  style={{
                    background: newEvents.includes(type)
                      ? 'var(--color-primary-bg, #eff6ff)'
                      : 'var(--color-bg)',
                    border: `1px solid ${newEvents.includes(type) ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newEvents.includes(type)}
                    onChange={() => toggleEventType(type)}
                    className="rounded"
                  />
                  <span className="font-mono text-xs">{type}</span>
                </label>
              ))}
            </div>
          </div>

          {formError && (
            <p className="text-sm text-red-600">{formError}</p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              Create Endpoint
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Endpoints list */}
      {endpoints.length === 0 && !showCreate ? (
        <div
          className="rounded-lg p-8 text-center"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
        >
          <p className="text-4xl mb-3">🔗</p>
          <p className="font-medium" style={{ color: 'var(--color-text)' }}>
            No webhook endpoints configured
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Add an endpoint to receive real-time notifications about orders, tickets, and check-ins.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className="rounded-lg p-4"
              style={{
                background: 'var(--color-card)',
                border: '1px solid var(--color-border)',
                opacity: ep.active ? 1 : 0.6,
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={ep.active ? 'active' : 'inactive'} />
                    {ep.eventId ? (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                        Event-scoped
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-warning-bg, #fef3c7)', color: 'var(--color-warning, #d97706)' }}>
                        Org-wide
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-sm truncate" style={{ color: 'var(--color-text)' }}>
                    {ep.url}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(ep.events as string[]).map((evt) => (
                      <span
                        key={evt}
                        className="text-xs px-2 py-0.5 rounded-full font-mono"
                        style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
                      >
                        {evt}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleViewDeliveries(ep)}
                    className="rounded px-3 py-1.5 text-xs"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                    title="View delivery log"
                  >
                    📋 Log
                  </button>
                  <button
                    onClick={() => handleRotateSecret(ep.id)}
                    className="rounded px-3 py-1.5 text-xs"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                    title="Rotate signing secret"
                  >
                    🔑 Rotate
                  </button>
                  <button
                    onClick={() => handleToggleActive(ep)}
                    className="rounded px-3 py-1.5 text-xs"
                    style={{
                      border: '1px solid var(--color-border)',
                      color: ep.active ? 'var(--color-warning, #d97706)' : 'var(--color-success, #22c55e)',
                    }}
                  >
                    {ep.active ? '⏸ Disable' : '▶ Enable'}
                  </button>
                  <button
                    onClick={() => handleDelete(ep.id)}
                    className="rounded px-3 py-1.5 text-xs text-red-600"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delivery log panel */}
      {selectedEndpoint && (
        <div
          className="rounded-lg p-5 space-y-4"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg" style={{ color: 'var(--color-text)' }}>
              Recent Deliveries
            </h3>
            <button
              onClick={() => setSelectedEndpoint(null)}
              className="text-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              ✕ Close
            </button>
          </div>
          <p className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
            {selectedEndpoint.url}
          </p>

          {selectedEndpoint.deliveries.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--color-text-muted)' }}>
              No deliveries yet
            </p>
          ) : (
            <div className="space-y-2">
              {selectedEndpoint.deliveries.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-3 rounded-md text-sm"
                  style={{ background: 'var(--color-bg)' }}
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge
                      status={
                        d.status === 'delivered'
                          ? 'paid'
                          : d.status === 'failed'
                            ? 'cancelled'
                            : 'pending'
                      }
                    />
                    <span className="font-mono text-xs">{d.eventType}</span>
                    {d.httpStatus && (
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        HTTP {d.httpStatus}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(d.createdAt).toLocaleString()}
                    </span>
                    {d.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(d.id)}
                        className="rounded px-2 py-1 text-xs"
                        style={{
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        ↻ Retry
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
