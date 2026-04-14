'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Order, type OrderDetails } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { TestBadge } from '@/components/test-badge';
import { useSSE } from '@/lib/sse';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

type ViewMode = 'list' | 'detail' | 'edit';

export default function OrdersPage() {
  const { t } = useI18n();
  const eventId = useEventId();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail / Edit state
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedOrder, setSelectedOrder] = useState<OrderDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [fCustomerName, setFCustomerName] = useState('');
  const [fCustomerEmail, setFCustomerEmail] = useState('');
  const [fNotes, setFNotes] = useState('');

  // Ticket type filter state
  const [filterTicketType, setFilterTicketType] = useState<string>('all');

  /** Get the primary ticket type name for an order (first item) */
  const getOrderTicketTypeName = (o: Order): string | null =>
    o.items?.[0]?.ticketType?.name ?? null;

  /** Unique ticket type names from current orders */
  const availableTicketTypes = useMemo(() => {
    const names = new Set<string>();
    for (const o of orders) {
      for (const item of o.items) {
        if (item.ticketType?.name) names.add(item.ticketType.name);
      }
    }
    return Array.from(names).sort();
  }, [orders]);

  /** Filtered orders based on ticket type */
  const filteredOrders = useMemo(() => {
    if (filterTicketType === 'all') return orders;
    return orders.filter((o) =>
      o.items.some((item) => item.ticketType?.name === filterTicketType),
    );
  }, [orders, filterTicketType]);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    api
      .getOrders(eventId, ac.signal)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [eventId]);

  // Live SSE updates — prepend new paid orders
  const handleNewOrder = useCallback((data: { orderId: string; orderNumber: string; status: string }) => {
    if (data.status === 'paid') {
      api.getOrders(eventId).then(setOrders).catch(() => {});
    }
  }, [eventId]);

  const { isConnected } = useSSE(`events/${eventId}/orders`, handleNewOrder, !!eventId);

  const totalRevenue = filteredOrders
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + o.totalCents, 0);

  const openDetail = async (order: Order) => {
    setDetailLoading(true);
    setError(null);
    setViewMode('detail');
    try {
      const details = await api.getOrderDetails(order.id);
      setSelectedOrder(details);
    } catch {
      setError('Failed to load order details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const openEdit = (order: OrderDetails) => {
    setFCustomerName(order.customerName ?? '');
    setFCustomerEmail(order.customerEmail ?? '');
    setFNotes(order.notes ?? '');
    setError(null);
    setViewMode('edit');
  };

  const handleSave = async () => {
    if (!selectedOrder) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateOrder(selectedOrder.id, {
        customerName: fCustomerName.trim() || undefined,
        customerEmail: fCustomerEmail.trim() || undefined,
        notes: fNotes.trim(),
      });
      // Refresh list + detail
      const [updatedOrders, updatedDetail] = await Promise.all([
        api.getOrders(eventId),
        api.getOrderDetails(selectedOrder.id),
      ]);
      setOrders(updatedOrders);
      setSelectedOrder(updatedDetail);
      setViewMode('detail');
    } catch (err: any) {
      setError(err?.message ?? t('orders.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (order: Order) => {
    const msg = t('orders.confirmCancel').replace('{orderNumber}', order.orderNumber);
    if (!confirm(msg)) return;
    try {
      await api.cancelOrder(order.id);
      const updated = await api.getOrders(eventId);
      setOrders(updated);
      if (selectedOrder?.id === order.id) {
        const refreshed = await api.getOrderDetails(order.id);
        setSelectedOrder(refreshed);
      }
    } catch {
      alert(t('orders.failedToCancel'));
    }
  };

  const handleDelete = async (order: Order) => {
    const msg = t('orders.confirmDelete').replace('{orderNumber}', order.orderNumber);
    if (!confirm(msg)) return;
    try {
      await api.deleteOrder(order.id);
      const updated = await api.getOrders(eventId);
      setOrders(updated);
      if (selectedOrder?.id === order.id) {
        setSelectedOrder(null);
        setViewMode('list');
      }
    } catch {
      alert(t('orders.failedToDelete'));
    }
  };

  const backToList = () => {
    setViewMode('list');
    setSelectedOrder(null);
    setError(null);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg"
            style={{ background: 'var(--color-bg-muted)' }}
          />
        ))}
      </div>
    );
  }

  // ── Detail / Edit View ──
  if (viewMode !== 'list' && selectedOrder) {
    return (
      <div>
        {/* Back button & title */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={backToList}
            className="rounded-lg p-2 transition-colors"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
          >
            <Icons.ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
              {viewMode === 'edit' ? t('orders.editOrder') : t('orders.detail.title')}
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {selectedOrder.orderNumber}
              {!!(selectedOrder as Order).meta?.isTestOrder && <TestBadge />}
            </p>
          </div>
          <div className="flex gap-2">
            {viewMode === 'detail' && (
              <>
                <button
                  onClick={() => openEdit(selectedOrder)}
                  className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  <span className="inline-flex items-center gap-1"><Icons.Edit size={14} /> {t('orders.editOrder')}</span>
                </button>
                {selectedOrder.status !== 'cancelled' && selectedOrder.status !== 'refunded' && (
                  <button
                    onClick={() => handleCancel(selectedOrder)}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-danger, #ef4444)' }}
                  >
                    <span className="inline-flex items-center gap-1"><Icons.Ban size={14} /> {t('orders.cancelOrder')}</span>
                  </button>
                )}
                {(selectedOrder.status === 'pending' || selectedOrder.status === 'cancelled') && (
                  <button
                    onClick={() => handleDelete(selectedOrder)}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-danger, #ef4444)' }}
                  >
                    <span className="inline-flex items-center gap-1"><Icons.Trash size={14} /> {t('orders.deleteOrder')}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {detailLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg" style={{ background: 'var(--color-bg-muted)' }} />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {error && (
              <div
                className="rounded-lg px-4 py-2 text-sm"
                style={{ background: 'var(--color-error-bg, #fee2e2)', color: 'var(--color-error-text, #991b1b)' }}
              >
                {error}
              </div>
            )}

            {/* Order Info Card */}
            <div
              className="rounded-xl p-5"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            >
              <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                {t('orders.detail.orderInfo')}
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <InfoField label={t('orders.column.status')} value={<StatusBadge status={selectedOrder.status} />} />
                <InfoField
                  label={t('orders.column.total')}
                  value={`${(selectedOrder.totalCents / 100).toFixed(2)} ${selectedOrder.currency}`}
                />
                <InfoField
                  label={t('orders.column.date')}
                  value={new Date(selectedOrder.createdAt).toLocaleDateString('en-CH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                />
                {selectedOrder.paidAt && (
                  <InfoField
                    label={t('orders.detail.paidAt')}
                    value={new Date(selectedOrder.paidAt).toLocaleDateString('en-CH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  />
                )}
                {!!(selectedOrder.meta as Record<string, unknown> | null)?.stripePaymentId && (
                  <InfoField label={t('orders.detail.stripeRef')} value={String((selectedOrder.meta as Record<string, unknown>).stripePaymentId)} />
                )}
              </div>
            </div>

            {/* Customer / Attendee Card */}
            <div
              className="rounded-xl p-5"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            >
              <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                {t('orders.detail.customer')}
              </h2>
              {viewMode === 'edit' ? (
                <div className="space-y-4">
                  <FieldInput
                    label={t('orders.form.customerName')}
                    value={fCustomerName}
                    onChange={setFCustomerName}
                    placeholder="Jane Doe"
                  />
                  <FieldInput
                    label={t('orders.form.customerEmail')}
                    value={fCustomerEmail}
                    onChange={setFCustomerEmail}
                    placeholder="jane@example.com"
                    type="email"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <InfoField label={t('orders.column.customer')} value={selectedOrder.attendee ? `${selectedOrder.attendee.firstName} ${selectedOrder.attendee.lastName}` : selectedOrder.customerName ?? '—'} />
                  <InfoField label={t('orders.column.email')} value={selectedOrder.customerEmail ?? selectedOrder.attendee?.email ?? '—'} />
                  {selectedOrder.attendee?.company && (
                    <InfoField label={t('attendees.column.company')} value={selectedOrder.attendee.company} />
                  )}
                </div>
              )}
            </div>

            {/* Line Items */}
            <div
              className="rounded-xl p-5"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            >
              <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                {t('orders.detail.lineItems')}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                      <th className="pb-2 text-left font-medium">{t('orders.detail.ticketType')}</th>
                      <th className="pb-2 text-right font-medium">{t('orders.detail.qty')}</th>
                      <th className="pb-2 text-right font-medium">{t('orders.detail.unitPrice')}</th>
                      <th className="pb-2 text-right font-medium">{t('orders.detail.subtotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.items.map((item) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="py-2" style={{ color: 'var(--color-text)' }}>
                          {item.ticketType?.name ?? item.ticketTypeId}
                        </td>
                        <td className="py-2 text-right" style={{ color: 'var(--color-text)' }}>
                          {item.quantity}
                        </td>
                        <td className="py-2 text-right" style={{ color: 'var(--color-text-secondary)' }}>
                          {(item.unitPriceCents / 100).toFixed(2)} {selectedOrder.currency}
                        </td>
                        <td className="py-2 text-right font-medium" style={{ color: 'var(--color-text)' }}>
                          {(item.subtotalCents / 100).toFixed(2)} {selectedOrder.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="py-2 text-right font-semibold" style={{ color: 'var(--color-text)' }}>
                        {t('orders.column.total')}
                      </td>
                      <td className="py-2 text-right font-bold" style={{ color: 'var(--color-text)' }}>
                        {(selectedOrder.totalCents / 100).toFixed(2)} {selectedOrder.currency}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Tickets */}
            {(selectedOrder.tickets?.length ?? 0) > 0 && (
              <div
                className="rounded-xl p-5"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.tickets')}
                </h2>
                <div className="space-y-2">
                  {selectedOrder.tickets!.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ background: 'var(--color-bg-subtle)' }}
                    >
                      <span className="font-mono text-sm" style={{ color: 'var(--color-text)' }}>
                        {ticket.code}
                      </span>
                      <StatusBadge status={ticket.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div
              className="rounded-xl p-5"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            >
              <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                {t('orders.detail.notes')}
              </h2>
              {viewMode === 'edit' ? (
                <textarea
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  placeholder={t('orders.detail.notesPlaceholder')}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={{
                    background: 'var(--color-bg-subtle)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              ) : (
                <p className="text-sm" style={{ color: selectedOrder.notes ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {selectedOrder.notes || t('orders.detail.notesPlaceholder')}
                </p>
              )}
            </div>

            {/* Edit action buttons */}
            {viewMode === 'edit' && (
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setViewMode('detail')}
                  className="rounded-lg px-4 py-2 text-sm font-medium"
                  style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {saving ? t('common.saving') : t('common.saveChanges')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── List View ──
  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('orders.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {filterTicketType !== 'all'
              ? t('orders.subtitleFiltered')
                  .replace('{shown}', String(filteredOrders.length))
                  .replace('{total}', String(orders.length))
              : totalRevenue > 0
                ? t('orders.revenueSubtitle')
                    .replace('{count}', String(orders.length))
                    .replace('{revenue}', (totalRevenue / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 }))
                : t('orders.subtitle').replace('{count}', String(orders.length))}
            {isConnected && (
              <span
                className="ml-2 inline-flex items-center gap-1 text-xs"
                style={{ color: 'var(--color-success)' }}
              >
                <span className="animate-pulse-live inline-block h-2 w-2 rounded-full" style={{ background: 'var(--color-success)' }} />
                {t('common.live')}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={filterTicketType}
            onChange={(e) => setFilterTicketType(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm transition-colors"
            style={{
              background: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
            aria-label={t('orders.filterByTicketType')}
          >
            <option value="all">{t('orders.filter.allTicketTypes')}</option>
            {availableTicketTypes.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <a
            href={api.exportOrders(eventId)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
                    <span className="inline-flex items-center gap-1"><Icons.Download size={14} /> {t('common.exportCsv')}</span>
          </a>
        </div>
      </div>

      <DataTable<Order & Record<string, unknown>>
        columns={[
          {
            key: 'orderNumber',
            header: t('orders.column.orderNumber'),
            render: (row) => (
              <span
                className="inline-flex cursor-pointer items-center font-medium hover:underline"
                onClick={() => openDetail(row as Order)}
              >
                {row.orderNumber}
                {!!(row as Order).meta?.isTestOrder && <TestBadge />}
              </span>
            ),
          },
          {
            key: 'customerName',
            header: t('orders.column.customer'),
            render: (row) => {
              const o = row as Order;
              return o.attendee
                ? `${o.attendee.firstName} ${o.attendee.lastName}`
                : o.customerName ?? '—';
            },
          },
          { key: 'customerEmail', header: t('orders.column.email') },
          {
            key: 'totalCents',
            header: t('orders.column.total'),
            render: (row) =>
              `${((row.totalCents as number) / 100).toFixed(2)} ${row.currency}`,
          },
          {
            key: 'status',
            header: t('orders.column.status'),
            render: (row) => <StatusBadge status={row.status as string} />,
          },
          {
            key: '_ticketType',
            header: t('orders.column.ticketType'),
            render: (row) => {
              const o = row as Order;
              const names = o.items
                ?.map((item) => item.ticketType?.name)
                .filter(Boolean);
              if (!names || names.length === 0)
                return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
              return <span className="text-xs">{names.join(', ')}</span>;
            },
          },
          {
            key: 'createdAt',
            header: t('orders.column.date'),
            render: (row) =>
              new Date(row.createdAt as string).toLocaleDateString('en-CH', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
          },
          {
            key: 'id',
            header: t('orders.column.actions'),
            render: (row) => (
              <div className="flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); openDetail(row as Order); }}
                  className="rounded px-2 py-1 text-xs"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={t('orders.viewDetails')}
                >
                  <Icons.Eye size={14} />
                </button>
                {(row.status as string) !== 'cancelled' && (row.status as string) !== 'refunded' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCancel(row as Order); }}
                    className="rounded px-2 py-1 text-xs"
                    style={{ color: 'var(--color-danger, #ef4444)' }}
                    title={t('orders.cancelOrder')}
                  >
                    <Icons.Ban size={14} />
                  </button>
                )}
                {((row.status as string) === 'pending' || (row.status as string) === 'cancelled') && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(row as Order); }}
                    className="rounded px-2 py-1 text-xs"
                    style={{ color: 'var(--color-danger, #ef4444)' }}
                    title={t('orders.deleteOrder')}
                  >
                    <Icons.Trash size={14} />
                  </button>
                )}
              </div>
            ),
          },
        ]}
        data={filteredOrders as (Order & Record<string, unknown>)[]}
        searchKeys={['orderNumber', 'customerName', 'customerEmail']}
        emptyMessage={t('orders.empty')}
      />
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </p>
      <div className="mt-1 text-sm" style={{ color: 'var(--color-text)' }}>
        {value}
      </div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{
          background: 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      />
    </div>
  );
}
