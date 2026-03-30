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
      <h2 className="text-xl font-semibold mb-4">{t('logistics.title')}</h2>

      {/* Sub-tab navigation */}
      <div className="flex gap-1 border-b mb-4">
        {(['overview', 'requests', 'stock'] as SubTab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
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

  if (loading) return <p className="text-gray-500">{t('common.loading')}</p>;
  if (!data) return <p className="text-gray-500">{t('logistics.noData')}</p>;

  const fc = data.fulfillmentCounts;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('logistics.totalOrders')} value={String(data.totalOrders)} />
        <StatCard label={t('logistics.totalRevenue')} value={`CHF ${(data.totalRevenue / 100).toFixed(2)}`} />
        <StatCard label={t('logistics.fulfilled')} value={String(fc.fulfilled)} color="text-green-600" />
        <StatCard label={t('logistics.pending')} value={String(fc.pending)} color="text-amber-600" />
      </div>

      {/* Stock status table */}
      <div>
        <h3 className="text-lg font-medium mb-2">{t('logistics.stockStatus')}</h3>
        {data.stockSummary.length === 0 ? (
          <p className="text-gray-500 text-sm">{t('logistics.noItems')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
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
                  <tr key={item.id} className="border-b">
                    <td className="py-2 pr-4 font-medium">{item.name}</td>
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
          <h3 className="text-lg font-medium mb-2">{t('logistics.fulfillmentBreakdown')}</h3>
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

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? ''}`}>{value}</p>
    </div>
  );
}

function StockBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    available: 'bg-green-100 text-green-700',
    low: 'bg-amber-100 text-amber-700',
    out_of_stock: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = {
    available: 'In Stock',
    low: 'Low Stock',
    out_of_stock: 'Out of Stock',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function FulfillmentBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span>{count} ({pct}%)</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
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

  if (loading) return <p className="text-gray-500">{t('common.loading')}</p>;

  if (orders.length === 0) {
    return <p className="text-gray-500 text-sm">{t('logistics.noOrders')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
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
            <tr key={order.id} className="border-b hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono text-xs">{order.orderNumber}</td>
              <td className="py-2 pr-4">
                <div className="font-medium">{order.org.name}</div>
                {order.customerEmail && (
                  <div className="text-xs text-gray-400">{order.customerEmail}</div>
                )}
              </td>
              <td className="py-2 pr-4">
                {order.items.map((li) => (
                  <div key={li.id} className="text-xs">
                    {li.quantity}× {li.item.name}
                  </div>
                ))}
              </td>
              <td className="py-2 pr-4 text-right font-medium">
                {order.currency} {(order.totalCents / 100).toFixed(2)}
              </td>
              <td className="py-2 pr-4">
                <StatusBadge status={order.status} />
              </td>
              <td className="py-2 pr-4">
                <FulfillmentBadge status={order.fulfillmentStatus} />
              </td>
              <td className="py-2 pr-4 text-xs text-gray-500">
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
  const colors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    fulfilled: 'bg-green-100 text-green-700',
    problematic: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
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
          className="text-xs px-2 py-1 rounded border hover:bg-gray-100"
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

  if (loading) return <p className="text-gray-500">{t('common.loading')}</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">{items.length} {t('logistics.itemsCount')}</span>
        <button
          onClick={() => { setEditItem(null); setShowForm(true); }}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
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
        <p className="text-gray-500 text-sm">{t('logistics.noItems')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
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
                <tr key={item.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium">{item.name}</td>
                  <td className="py-2 pr-4 text-gray-500 text-xs max-w-xs truncate">{item.description || '—'}</td>
                  <td className="py-2 pr-4 text-right">CHF {(item.priceCents / 100).toFixed(2)}</td>
                  <td className="py-2 pr-4 text-right">{item.stockTotal}</td>
                  <td className="py-2 pr-4 text-right">{item.stockReserved}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditItem(item); setShowForm(true); }}
                        className="text-gray-400 hover:text-gray-600"
                        title={t('common.edit')}
                      >
                        <Icons.Edit size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="text-gray-400 hover:text-red-600"
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
    <form onSubmit={handleSubmit} className="mb-4 p-4 border rounded-lg bg-gray-50 space-y-3">
      <div className="flex justify-between items-center">
        <h4 className="font-medium">{item ? t('logistics.editItem') : t('logistics.addItem')}</h4>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('logistics.itemName')} *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-1.5 text-sm border rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('logistics.price')} (CHF) *</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceChf}
            onChange={(e) => setPriceChf(e.target.value)}
            required
            className="w-full px-3 py-1.5 text-sm border rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('logistics.stockTotal')} *</label>
          <input
            type="number"
            min="0"
            value={stockTotal}
            onChange={(e) => setStockTotal(e.target.value)}
            required
            className="w-full px-3 py-1.5 text-sm border rounded"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">{t('logistics.description')}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-1.5 text-sm border rounded"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {saving ? t('common.saving') : (item ? t('common.save') : t('logistics.addItem'))}
        </button>
      </div>
    </form>
  );
}
