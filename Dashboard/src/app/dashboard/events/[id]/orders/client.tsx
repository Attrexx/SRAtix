'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type Order, type OrderDetails, type PaymentInfo } from '@/lib/api';
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

  // Payment info + email actions
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null); // which email action is in progress
  const [emailResult, setEmailResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
    setEmailResult(null);
    setPaymentInfo(null);
    setViewMode('detail');
    try {
      const [details, pmInfo] = await Promise.all([
        api.getOrderDetails(order.id),
        order.status === 'paid' ? api.getPaymentInfo(order.id).catch(() => null) : Promise.resolve(null),
      ]);
      setSelectedOrder(details);
      setPaymentInfo(pmInfo);
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
    setEmailResult(null);
    setPaymentInfo(null);
  };

  const handleResendConfirmation = async () => {
    if (!selectedOrder) return;
    setSendingEmail('confirmation');
    setEmailResult(null);
    try {
      const result = await api.resendConfirmation(selectedOrder.id);
      if (result.success) {
        setEmailResult({ type: 'success', message: t('orders.email.confirmationSent').replace('{email}', result.email ?? '') });
      } else {
        setEmailResult({ type: 'error', message: result.message ?? t('orders.email.sendFailed') });
      }
    } catch {
      setEmailResult({ type: 'error', message: t('orders.email.sendFailed') });
    } finally {
      setSendingEmail(null);
    }
  };

  const handleResendGiftNotifications = async () => {
    if (!selectedOrder) return;
    setSendingEmail('gift');
    setEmailResult(null);
    try {
      const result = await api.resendGiftNotifications(selectedOrder.id);
      const failed = result.results.filter((r) => !r.success);
      if (failed.length === 0) {
        setEmailResult({ type: 'success', message: t('orders.email.giftSent').replace('{count}', String(result.sent)) });
      } else {
        setEmailResult({ type: 'error', message: t('orders.email.giftPartial').replace('{sent}', String(result.sent)).replace('{total}', String(result.total)) });
      }
    } catch {
      setEmailResult({ type: 'error', message: t('orders.email.sendFailed') });
    } finally {
      setSendingEmail(null);
    }
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
    const meta = (selectedOrder.meta as Record<string, unknown>) ?? {};
    const hasGiftRecipients = Array.isArray(meta.recipientAttendees) && (meta.recipientAttendees as unknown[]).length > 0;
    const att = selectedOrder.attendee;
    const formSubs = att?.formSubmissions ?? [];

    return (
      <div>
        {/* Back button & title row */}
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={backToList}
            className="rounded-lg p-2 transition-colors"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
          >
            <Icons.ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
              {viewMode === 'edit' ? t('orders.editOrder') : t('orders.detail.title')}
            </h1>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {selectedOrder.orderNumber}
              {!!meta.isTestOrder && <TestBadge />}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {viewMode === 'detail' && (
              <>
                <button
                  onClick={() => openEdit(selectedOrder)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  <span className="inline-flex items-center gap-1"><Icons.Edit size={13} /> {t('orders.editOrder')}</span>
                </button>
                {selectedOrder.status !== 'cancelled' && selectedOrder.status !== 'refunded' && (
                  <button
                    onClick={() => handleCancel(selectedOrder)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-danger, #ef4444)' }}
                  >
                    <span className="inline-flex items-center gap-1"><Icons.Ban size={13} /> {t('orders.cancelOrder')}</span>
                  </button>
                )}
                {(selectedOrder.status === 'pending' || selectedOrder.status === 'cancelled') && (
                  <button
                    onClick={() => handleDelete(selectedOrder)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-danger, #ef4444)' }}
                  >
                    <span className="inline-flex items-center gap-1"><Icons.Trash size={13} /> {t('orders.deleteOrder')}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {detailLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg" style={{ background: 'var(--color-bg-muted)' }} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div
                className="rounded-lg px-4 py-2 text-sm"
                style={{ background: 'var(--color-error-bg, #fee2e2)', color: 'var(--color-error-text, #991b1b)' }}
              >
                {error}
              </div>
            )}

            {/* Email action feedback */}
            {emailResult && (
              <div
                className="rounded-lg px-4 py-2 text-sm flex items-center justify-between"
                style={{
                  background: emailResult.type === 'success' ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-error-bg, #fee2e2)',
                  color: emailResult.type === 'success' ? 'var(--color-success-text, #166534)' : 'var(--color-error-text, #991b1b)',
                }}
              >
                <span>{emailResult.message}</span>
                <button onClick={() => setEmailResult(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}

            {/* ── Top 2-column grid: Order Info + Customer ── */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Order Info */}
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.orderInfo')}
                </h2>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <InfoField label={t('orders.column.status')} value={<StatusBadge status={selectedOrder.status} />} />
                  <InfoField
                    label={t('orders.column.total')}
                    value={`${(selectedOrder.totalCents / 100).toFixed(2)} ${selectedOrder.currency}`}
                  />
                  <InfoField
                    label={t('orders.column.date')}
                    value={new Date(selectedOrder.createdAt).toLocaleDateString('en-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  />
                  {selectedOrder.paidAt && (
                    <InfoField
                      label={t('orders.detail.paidAt')}
                      value={new Date(selectedOrder.paidAt).toLocaleDateString('en-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    />
                  )}
                  {selectedOrder.stripePaymentId && (
                    <InfoField label={t('orders.detail.stripeRef')} value={
                      <code className="text-[10px] break-all">{selectedOrder.stripePaymentId}</code>
                    } />
                  )}
                  {!!meta.promoCodeId && (
                    <InfoField label={t('orders.detail.promoCode')} value={String(meta.promoCodeLabel ?? meta.promoCodeId)} />
                  )}
                </div>
              </div>

              {/* Customer / Attendee */}
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.customer')}
                </h2>
                {viewMode === 'edit' ? (
                  <div className="space-y-3">
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
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <InfoField label={t('orders.column.customer')} value={att ? `${att.firstName} ${att.lastName}` : selectedOrder.customerName ?? '—'} />
                    <InfoField label={t('orders.column.email')} value={selectedOrder.customerEmail ?? att?.email ?? '—'} />
                    {att?.company && <InfoField label={t('attendees.column.company')} value={att.company} />}
                    {att?.phone && <InfoField label={t('orders.detail.phone')} value={att.phone} />}
                    {att?.jobTitle && <InfoField label={t('orders.detail.jobTitle')} value={att.jobTitle} />}
                    {att?.orgRole && <InfoField label={t('orders.detail.orgRole')} value={att.orgRole} />}
                    {att?.badgeName && <InfoField label={t('orders.detail.badgeName')} value={att.badgeName} />}
                    {att?.dietaryNeeds && <InfoField label={t('orders.detail.dietaryNeeds')} value={att.dietaryNeeds} />}
                    {att?.accessibilityNeeds && <InfoField label={t('orders.detail.accessibilityNeeds')} value={att.accessibilityNeeds} />}
                  </div>
                )}
              </div>
            </div>

            {/* ── Payment Info + Line Items ── */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Payment */}
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.payment')}
                </h2>
                {paymentInfo?.available ? (
                  <div className="flex items-center gap-3">
                    <Icons.CreditCard size={20} style={{ color: 'var(--color-text-secondary)' }} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {paymentInfo.brand ? paymentInfo.brand.charAt(0).toUpperCase() + paymentInfo.brand.slice(1) : 'Card'} •••• {paymentInfo.last4}
                      </p>
                      {paymentInfo.expMonth && paymentInfo.expYear && (
                        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          Exp {String(paymentInfo.expMonth).padStart(2, '0')}/{String(paymentInfo.expYear).slice(-2)}
                          {paymentInfo.country ? ` · ${paymentInfo.country.toUpperCase()}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {selectedOrder.status === 'paid' ? t('orders.detail.paymentInfoUnavailable') : t('orders.detail.notPaidYet')}
                  </p>
                )}
                {selectedOrder.billingAddress && Object.keys(selectedOrder.billingAddress).length > 0 && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <p className="text-[10px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      {t('orders.detail.billingAddress')}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {Object.values(selectedOrder.billingAddress).filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
              </div>

              {/* Line Items */}
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.lineItems')}
                </h2>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                      <th className="pb-1.5 text-left font-medium">{t('orders.detail.ticketType')}</th>
                      <th className="pb-1.5 text-right font-medium">{t('orders.detail.qty')}</th>
                      <th className="pb-1.5 text-right font-medium">{t('orders.detail.unitPrice')}</th>
                      <th className="pb-1.5 text-right font-medium">{t('orders.detail.subtotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.items.map((item) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="py-1.5" style={{ color: 'var(--color-text)' }}>
                          {item.ticketType?.name ?? item.ticketTypeId}
                        </td>
                        <td className="py-1.5 text-right" style={{ color: 'var(--color-text)' }}>
                          {item.quantity}
                        </td>
                        <td className="py-1.5 text-right" style={{ color: 'var(--color-text-secondary)' }}>
                          {(item.unitPriceCents / 100).toFixed(2)} {selectedOrder.currency}
                        </td>
                        <td className="py-1.5 text-right font-medium" style={{ color: 'var(--color-text)' }}>
                          {(item.subtotalCents / 100).toFixed(2)} {selectedOrder.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="py-1.5 text-right font-semibold" style={{ color: 'var(--color-text)' }}>
                        {t('orders.column.total')}
                      </td>
                      <td className="py-1.5 text-right font-bold" style={{ color: 'var(--color-text)' }}>
                        {(selectedOrder.totalCents / 100).toFixed(2)} {selectedOrder.currency}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ── Tickets ── */}
            {(selectedOrder.tickets?.length ?? 0) > 0 && (
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.tickets')} ({selectedOrder.tickets!.length})
                </h2>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedOrder.tickets!.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center justify-between rounded-lg px-3 py-1.5"
                      style={{ background: 'var(--color-bg-subtle)' }}
                    >
                      <code className="text-xs font-mono" style={{ color: 'var(--color-text)' }}>
                        {ticket.code}
                      </code>
                      <StatusBadge status={ticket.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Form Submissions ── */}
            {formSubs.length > 0 && (
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.formData')}
                </h2>
                {formSubs.map((sub) => {
                  const schemaFields = Array.isArray(sub.formSchema?.fields) ? sub.formSchema!.fields as Array<{ key: string; label?: string; type?: string }> : [];
                  const labelMap = new Map(schemaFields.map((f) => [f.key, f.label ?? f.key]));
                  const entries = Object.entries(sub.data).filter(([k]) => !k.startsWith('_'));
                  return (
                    <div key={sub.id} className="mb-3 last:mb-0">
                      <p className="text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        {sub.formSchema?.name ?? 'Form'} v{sub.formSchema?.version ?? 1}
                        <span className="ml-2 font-normal normal-case">
                          {new Date(sub.submittedAt).toLocaleDateString('en-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                        {entries.map(([key, value]) => (
                          <InfoField
                            key={key}
                            label={labelMap.get(key) ?? key}
                            value={
                              typeof value === 'boolean'
                                ? (value ? '✓' : '✗')
                                : Array.isArray(value)
                                  ? value.join(', ')
                                  : String(value ?? '—')
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Notes ── */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            >
              <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {t('orders.detail.notes')}
              </h2>
              {viewMode === 'edit' ? (
                <textarea
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  placeholder={t('orders.detail.notesPlaceholder')}
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={{
                    background: 'var(--color-bg-subtle)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              ) : (
                <p className="text-xs" style={{ color: selectedOrder.notes ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {selectedOrder.notes || t('orders.detail.notesPlaceholder')}
                </p>
              )}
            </div>

            {/* ── Email Actions ── */}
            {viewMode === 'detail' && selectedOrder.status === 'paid' && (
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.emailActions')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleResendConfirmation}
                    disabled={sendingEmail !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                    style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {sendingEmail === 'confirmation' ? (
                      <Icons.RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Icons.Mail size={13} />
                    )}
                    {t('orders.email.resendConfirmation')}
                  </button>
                  {hasGiftRecipients && (
                    <button
                      onClick={handleResendGiftNotifications}
                      disabled={sendingEmail !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                      style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {sendingEmail === 'gift' ? (
                        <Icons.RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Icons.Mail size={13} />
                      )}
                      {t('orders.email.resendGiftNotifications')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Metadata ── */}
            {Object.keys(meta).filter((k) => !['isTestOrder', 'recipientAttendees', 'registrationBaseUrl'].includes(k)).length > 0 && (
              <details
                className="rounded-xl overflow-hidden"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t('orders.detail.metadata')}
                </summary>
                <div className="px-4 pb-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                    {Object.entries(meta)
                      .filter(([k]) => !['isTestOrder', 'recipientAttendees', 'registrationBaseUrl'].includes(k))
                      .map(([key, value]) => (
                        <InfoField key={key} label={key} value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')} />
                      ))}
                  </div>
                </div>
              </details>
            )}

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
