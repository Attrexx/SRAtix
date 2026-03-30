'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import {
  api,
  type LogisticsItem,
  type LogisticsOrderAdmin,
  type LogisticsOverview,
} from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';
import { toast } from 'sonner';

type SubTab = 'overview' | 'requests' | 'stock';

export default function LogisticsPage() {
  const { t } = useI18n();
  const eventId = useEventId();
  const [tab, setTab] = useState<SubTab>('overview');

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{t('logistics.title')}</h2>

      {/* Sub-tab navigation */}
      <div className="flex gap-1 mb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {(['overview', 'requests', 'stock'] as SubTab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              borderBottom: tab === key ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: tab === key ? 'var(--color-primary)' : 'var(--color-text-muted)',
            }}
          >
            {t(`logistics.tab${key[0].toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab eventId={eventId} />}
      {tab === 'requests' && <RequestsTab eventId={eventId} />}
      {tab === 'stock' && <StockTab eventId={eventId} />}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────

function OverviewTab({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<LogisticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const ac = new AbortController();
    api.getLogisticsOverview(eventId, ac.signal)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [eventId]);

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>;
  if (!data) return <p style={{ color: 'var(--color-text-muted)' }}>{t('logistics.noData')}</p>;

  const fc = data.fulfillmentCounts;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('logistics.totalOrders')} value={String(data.totalOrders)} />
        <StatCard label={t('logistics.totalRevenue')} value={`CHF ${(data.totalRevenue / 100).toFixed(2)}`} />
        <StatCard label={t('logistics.fulfilled')} value={String(fc.fulfilled)} valueColor="var(--color-success, #16a34a)" />
        <StatCard label={t('logistics.pending')} value={String(fc.pending)} valueColor="var(--color-warning, #d97706)" />
      </div>

      {/* Stock status table */}
      <div>
        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>{t('logistics.stockStatus')}</h3>
        {data.stockSummary.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('logistics.noItems')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                  <th className="py-2 pr-4">{t('logistics.itemName')}</th>
                  <th className="py-2 pr-4 text-right">{t('logistics.price')}</th>
                  <th className="py-2 pr-4 text-right">{t('logistics.stockTotal')}</th>
                  <th className="py-2 pr-4 text-right">{t('logistics.sold')}</th>
                  <th className="py-2 pr-4 text-right">{t('logistics.available')}</th>
                  <th className="py-2">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.stockSummary.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="py-2 pr-4 font-medium" style={{ color: 'var(--color-text)' }}>{item.name}</td>
                    <td className="py-2 pr-4 text-right">CHF {(item.priceCents / 100).toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">{item.stockTotal}</td>
                    <td className="py-2 pr-4 text-right">{item.sold}</td>
                    <td className="py-2 pr-4 text-right">{item.available}</td>
                    <td className="py-2">
                      <StockBadge status={item.stockStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fulfillment breakdown */}
      {data.totalOrders > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>{t('logistics.fulfillmentBreakdown')}</h3>
          <div className="flex gap-4">
            <FulfillmentBar label={t('logistics.fulfilled')} count={fc.fulfilled} total={data.totalOrders} color="bg-green-500" />
            <FulfillmentBar label={t('logistics.pendingLabel')} count={fc.pending} total={data.totalOrders} color="bg-amber-500" />
            <FulfillmentBar label={t('logistics.problematic')} count={fc.problematic} total={data.totalOrders} color="bg-red-500" />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
      <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: valueColor ?? 'var(--color-text)' }}>{value}</p>
    </div>
  );
}

function StockBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    available: { bg: 'rgba(34,197,94,0.15)', color: '#16a34a' },
    low: { bg: 'rgba(245,158,11,0.15)', color: '#d97706' },
    out_of_stock: { bg: 'rgba(239,68,68,0.15)', color: '#dc2626' },
  };
  const labels: Record<string, string> = {
    available: 'In Stock',
    low: 'Low Stock',
    out_of_stock: 'Out of Stock',
  };
  const s = styles[status] ?? { bg: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {labels[status] ?? status}
    </span>
  );
}

function FulfillmentBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
        <span>{label}</span>
        <span>{count} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-muted, var(--color-bg-subtle))' }}>
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Requests Tab ─────────────────────────────────────────────────────────

function RequestsTab({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const [orders, setOrders] = useState<LogisticsOrderAdmin[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setOrders(await api.getLogisticsOrders(eventId));
    } catch {
      toast.error(t('logistics.loadError'));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => { load(); }, [load]);

  const updateFulfillment = async (orderId: string, fulfillmentStatus: string) => {
    try {
      await api.updateLogisticsFulfillment(eventId, orderId, { fulfillmentStatus });
      toast.success(t('logistics.fulfillmentUpdated'));
      load();
    } catch {
      toast.error(t('logistics.fulfillmentError'));
    }
  };

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>;

  if (orders.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('logistics.noOrders')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', textAlign: 'left' }}>
            <th className="py-2 pr-4">{t('logistics.orderNumber')}</th>
            <th className="py-2 pr-4">{t('logistics.exhibitor')}</th>
            <th className="py-2 pr-4">{t('logistics.items')}</th>
            <th className="py-2 pr-4 text-right">{t('logistics.total')}</th>
            <th className="py-2 pr-4">{t('logistics.paymentStatus')}</th>
            <th className="py-2 pr-4">{t('logistics.fulfillment')}</th>
            <th className="py-2 pr-4">{t('logistics.date')}</th>
            <th className="py-2">{t('logistics.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td className="py-2 pr-4 font-mono text-xs" style={{ color: 'var(--color-text)' }}>{order.orderNumber}</td>
              <td className="py-2 pr-4">
                <div className="font-medium" style={{ color: 'var(--color-text)' }}>{order.org.name}</div>
                {order.customerEmail && (
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{order.customerEmail}</div>
                )}
              </td>
              <td className="py-2 pr-4">
                {order.items.map((li) => (
                  <div key={li.id} className="text-xs" style={{ color: 'var(--color-text)' }}>
                    {li.quantity}× {li.item.name}
                  </div>
                ))}
              </td>
              <td className="py-2 pr-4 text-right font-medium" style={{ color: 'var(--color-text)' }}>
                {order.currency} {(order.totalCents / 100).toFixed(2)}
              </td>
              <td className="py-2 pr-4">
                <StatusBadge status={order.status} />
              </td>
              <td className="py-2 pr-4">
                <FulfillmentBadge status={order.fulfillmentStatus} />
              </td>
              <td className="py-2 pr-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {new Date(order.createdAt).toLocaleDateString()}
              </td>
              <td className="py-2">
                <FulfillmentActions
                  current={order.fulfillmentStatus}
                  onUpdate={(s) => updateFulfillment(order.id, s)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FulfillmentBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    pending: { bg: 'rgba(245,158,11,0.15)', color: '#d97706' },
    fulfilled: { bg: 'rgba(34,197,94,0.15)', color: '#16a34a' },
    problematic: { bg: 'rgba(239,68,68,0.15)', color: '#dc2626' },
  };
  const s = styles[status] ?? { bg: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

function FulfillmentActions({ current, onUpdate }: { current: string; onUpdate: (s: string) => void }) {
  const options = ['pending', 'fulfilled', 'problematic'].filter((s) => s !== current);
  return (
    <div className="flex gap-1">
      {options.map((s) => (
        <button
          key={s}
          onClick={() => onUpdate(s)}
          className="text-xs px-2 py-1 rounded"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          title={`Mark ${s}`}
        >
          {s === 'fulfilled' ? '✓' : s === 'problematic' ? '!' : '⏳'}
        </button>
      ))}
    </div>
  );
}

// ─── Stock Tab ────────────────────────────────────────────────────────────

function StockTab({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<LogisticsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<LogisticsItem | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setItems(await api.getLogisticsItems(eventId));
    } catch {
      toast.error(t('logistics.loadError'));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (item: LogisticsItem) => {
    if (!confirm(t('logistics.confirmDelete'))) return;
    try {
      await api.deleteLogisticsItem(eventId, item.id);
      toast.success(t('logistics.itemDeleted'));
      load();
    } catch (err: any) {
      toast.error(err?.message ?? t('logistics.deleteError'));
    }
  };

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{items.length} {t('logistics.itemsCount')}</span>
        <button
          onClick={() => { setEditItem(null); setShowForm(true); }}
          className="px-3 py-1.5 text-sm text-white rounded"
          style={{ background: 'var(--color-primary)' }}
        >
          + {t('logistics.addItem')}
        </button>
      </div>

      {showForm && (
        <ItemForm
          eventId={eventId}
          item={editItem}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          onSaved={() => { setShowForm(false); setEditItem(null); load(); }}
        />
      )}

      {items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('logistics.noItems')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                <th className="py-2 pr-4">{t('logistics.itemName')}</th>
                <th className="py-2 pr-4">{t('logistics.description')}</th>
                <th className="py-2 pr-4 text-right">{t('logistics.price')}</th>
                <th className="py-2 pr-4 text-right">{t('logistics.stockTotal')}</th>
                <th className="py-2 pr-4 text-right">{t('logistics.reserved')}</th>
                <th className="py-2 pr-4">{t('common.status')}</th>
                <th className="py-2">{t('logistics.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="py-2 pr-4 font-medium" style={{ color: 'var(--color-text)' }}>{item.name}</td>
                  <td className="py-2 pr-4 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{item.description || '—'}</td>
                  <td className="py-2 pr-4 text-right" style={{ color: 'var(--color-text)' }}>CHF {(item.priceCents / 100).toFixed(2)}</td>
                  <td className="py-2 pr-4 text-right" style={{ color: 'var(--color-text)' }}>{item.stockTotal}</td>
                  <td className="py-2 pr-4 text-right" style={{ color: 'var(--color-text)' }}>{item.stockReserved}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditItem(item); setShowForm(true); }}
                        style={{ color: 'var(--color-text-muted)' }}
                        title={t('common.edit')}
                      >
                        <Icons.Edit size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        style={{ color: 'var(--color-text-muted)' }}
                        title={t('common.delete')}
                      >
                        <Icons.Trash size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ItemForm({
  eventId,
  item,
  onClose,
  onSaved,
}: {
  eventId: string;
  item: LogisticsItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [priceChf, setPriceChf] = useState(item ? (item.priceCents / 100).toFixed(2) : '');
  const [stockTotal, setStockTotal] = useState(item ? String(item.stockTotal) : '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceCents = Math.round(parseFloat(priceChf) * 100);
    if (isNaN(priceCents) || priceCents < 0) {
      toast.error(t('logistics.invalidPrice'));
      return;
    }
    const stock = parseInt(stockTotal, 10);
    if (isNaN(stock) || stock < 0) {
      toast.error(t('logistics.invalidStock'));
      return;
    }

    setSaving(true);
    try {
      if (item) {
        await api.updateLogisticsItem(eventId, item.id, { name, description: description || undefined, priceCents, stockTotal: stock });
      } else {
        await api.createLogisticsItem(eventId, { name, description: description || undefined, priceCents, stockTotal: stock });
      }
      toast.success(item ? t('logistics.itemUpdated') : t('logistics.itemCreated'));
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 rounded-lg space-y-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
      <div className="flex justify-between items-center">
        <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>{item ? t('logistics.editItem') : t('logistics.addItem')}</h4>
        <button type="button" onClick={onClose} style={{ color: 'var(--color-text-muted)' }}>✕</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('logistics.itemName')} *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('logistics.price')} *</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceChf}
            onChange={(e) => setPriceChf(e.target.value)}
            required
            className="w-full px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('logistics.stockTotal')} *</label>
          <input
            type="number"
            min="0"
            value={stockTotal}
            onChange={(e) => setStockTotal(e.target.value)}
            required
            className="w-full px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('logistics.description')}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm text-white rounded disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>
          {saving ? t('common.saving') : (item ? t('common.save') : t('logistics.addItem'))}
        </button>
      </div>
    </form>
  );
}
