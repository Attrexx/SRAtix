'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type SetupRequest } from '@/lib/api';
import { useI18n } from '@/i18n/i18n-provider';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  submitted: '#3b82f6',
  confirmed: '#22c55e',
  modification_requested: '#f59e0b',
};

export default function ExhibitorSetupPage() {
  const eventId = useEventId();
  const { t } = useI18n();
  const abortRef = useRef<AbortController | null>(null);

  const [requests, setRequests] = useState<SetupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');

  const load = useCallback(async () => {
    if (!eventId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      setLoading(true);
      const data = await api.getSetupRequests(eventId, ctrl.signal);
      setRequests(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      toast.error(t('exhibitorSetup.loadError'));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const handleStatusUpdate = async (requestId: string, status: string) => {
    try {
      await api.adminUpdateSetupRequest(requestId, {
        status,
        adminNotes: adminNotes || undefined,
      });
      toast.success(t('exhibitorSetup.updated'));
      setExpandedId(null);
      setAdminNotes('');
      load();
    } catch {
      toast.error(t('exhibitorSetup.updateError'));
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  };

  const getStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      draft: t('exhibitorSetup.statusDraft'),
      submitted: t('exhibitorSetup.statusSubmitted'),
      confirmed: t('exhibitorSetup.statusConfirmed'),
      modification_requested: t('exhibitorSetup.statusModRequested'),
    };
    return labels[status] || status;
  };

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">{t('exhibitorSetup.title')}</h2>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('exhibitorSetup.title')}</h2>

      {requests.length === 0 ? (
        <p className="text-gray-500">{t('exhibitorSetup.noRequests')}</p>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const isExpanded = expandedId === req.id;
            const companyName = req.eventExhibitor?.exhibitorProfile?.companyName || '—';
            const booth = req.eventExhibitor?.boothNumber || '';

            return (
              <div
                key={req.id}
                className="border rounded-lg overflow-hidden"
                style={{ borderColor: 'var(--color-border, #e5e7eb)' }}
              >
                {/* Header row */}
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  onClick={() => {
                    setExpandedId(isExpanded ? null : req.id);
                    setAdminNotes(req.adminNotes || '');
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ background: STATUS_COLORS[req.status] || '#94a3b8' }}
                    />
                    <span className="font-medium">{companyName}</span>
                    {booth && (
                      <span className="text-xs text-gray-500">
                        {t('exhibitorSetup.booth')} {booth}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: STATUS_COLORS[req.status] + '20',
                        color: STATUS_COLORS[req.status],
                      }}
                    >
                      {getStatusLabel(req.status)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDate(req.submittedAt || req.createdAt)}
                    </span>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t px-4 py-4 space-y-4" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                    {/* Submitted data */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">{t('exhibitorSetup.submittedData')}</h4>
                      {req.data && Object.keys(req.data).length > 0 ? (
                        <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto max-h-60">
                          {JSON.stringify(req.data, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-sm text-gray-400">{t('exhibitorSetup.noData')}</p>
                      )}
                    </div>

                    {/* Admin notes */}
                    <div>
                      <label className="block text-sm font-semibold mb-1">
                        {t('exhibitorSetup.adminNotes')}
                      </label>
                      <textarea
                        className="w-full border rounded px-3 py-2 text-sm"
                        rows={3}
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        placeholder={t('exhibitorSetup.adminNotesPlaceholder')}
                        style={{ borderColor: 'var(--color-border, #e5e7eb)' }}
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      {req.status === 'submitted' && (
                        <>
                          <button
                            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
                            onClick={() => handleStatusUpdate(req.id, 'confirmed')}
                          >
                            {t('exhibitorSetup.confirm')}
                          </button>
                          <button
                            className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
                            onClick={() => handleStatusUpdate(req.id, 'modification_requested')}
                          >
                            {t('exhibitorSetup.requestModification')}
                          </button>
                        </>
                      )}
                      {req.status === 'modification_requested' && (
                        <button
                          className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
                          onClick={() => handleStatusUpdate(req.id, 'confirmed')}
                        >
                          {t('exhibitorSetup.confirm')}
                        </button>
                      )}
                      {req.status === 'confirmed' && (
                        <span className="text-sm text-green-600 font-medium">
                          ✓ {t('exhibitorSetup.confirmedAt')} {formatDate(req.confirmedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
