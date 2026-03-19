'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useEventId } from '@/hooks/use-event-id';
import { api, type EventExhibitorCard } from '@/lib/api';
import { useI18n } from '@/i18n/i18n-provider';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  published: '#22c55e',
  archived: '#6b7280',
};

const PASS_STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  invited: '#3b82f6',
  registered: '#22c55e',
  checked_in: '#8b5cf6',
};

export default function ExhibitorSetupPage() {
  const eventId = useEventId();
  const { t } = useI18n();
  const abortRef = useRef<AbortController | null>(null);

  const [exhibitors, setExhibitors] = useState<EventExhibitorCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      setLoading(true);
      const data = await api.getExhibitors(eventId, ctrl.signal);
      setExhibitors(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      toast.error(t('exhibitors.loadError'));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString();
  };

  const handleDelete = async (ex: EventExhibitorCard) => {
    const msg = t('exhibitors.confirmDelete').replace('{name}', ex.companyName);
    if (!confirm(msg)) return;
    try {
      await api.deleteExhibitor(ex.id);
      if (selectedId === ex.id) setSelectedId(null);
      await load();
    } catch {
      alert(t('exhibitors.failedToDelete'));
    }
  };

  const selected = exhibitors.find((e) => e.id === selectedId) ?? null;

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">{t('exhibitors.title')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-48 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('exhibitors.title')}</h2>
        <span className="text-sm text-gray-500">{exhibitors.length} {t('exhibitors.total')}</span>
      </div>

      {exhibitors.length === 0 ? (
        <p className="text-gray-500">{t('exhibitors.none')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {exhibitors.map((ex) => (
            <div
              key={ex.id}
              className="relative border rounded-lg p-4 hover:shadow-md transition-shadow cursor-default"
              style={{ borderColor: 'var(--color-border, #e5e7eb)' }}
            >
              {/* Eye icon — detail modal trigger */}
              <div className="absolute top-3 right-3 flex items-center gap-1">
                <button
                  className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  onClick={() => setSelectedId(ex.id)}
                  title={t('exhibitors.viewDetails')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button
                  className="p-1.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 transition-colors"
                  onClick={() => handleDelete(ex)}
                  title={t('common.delete')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>

              {/* Logo + Company Name */}
              <div className="flex items-center gap-3 mb-3 pr-8">
                {ex.logoUrl ? (
                  <img
                    src={ex.logoUrl}
                    alt=""
                    className="w-10 h-10 rounded object-contain bg-gray-50 dark:bg-gray-800 flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-xs font-bold text-gray-400">
                    {ex.companyName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{ex.companyName}</p>
                  {ex.exhibitorCategory && (
                    <span className="text-xs text-gray-500">{ex.exhibitorCategory}</span>
                  )}
                </div>
              </div>

              {/* Buyer info */}
              {ex.buyerEmail && (
                <div className="text-xs text-gray-500 mb-3 truncate">
                  {ex.buyerName && <span className="font-medium">{ex.buyerName}</span>}
                  {ex.buyerName && ' · '}
                  <span>{ex.buyerEmail}</span>
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-3 text-xs">
                {/* Staff count */}
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{ background: ex.staffCount > 0 ? '#dbeafe' : '#f3f4f6', color: ex.staffCount > 0 ? '#1d4ed8' : '#6b7280' }}
                >
                  👤 {ex.staffSubmitted}/{ex.maxStaff > 0 ? ex.maxStaff : '∞'}
                </span>

                {/* Demo indicator */}
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{ background: ex.hasDemo ? '#dcfce7' : '#f3f4f6', color: ex.hasDemo ? '#166534' : '#6b7280' }}
                >
                  {ex.hasDemo ? '✓' : '✗'} {t('exhibitors.demo')}
                </span>

                {/* Booth */}
                {ex.boothNumber && (
                  <span className="text-gray-400">#{ex.boothNumber}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
              <div className="flex items-center gap-3">
                {selected.logoUrl ? (
                  <img src={selected.logoUrl} alt="" className="w-12 h-12 rounded object-contain bg-gray-50 dark:bg-gray-800" />
                ) : (
                  <div className="w-12 h-12 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-lg font-bold text-gray-400">
                    {selected.companyName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-semibold">{selected.companyName}</h3>
                  {selected.profile.legalName && selected.profile.legalName !== selected.companyName && (
                    <p className="text-xs text-gray-500">{selected.profile.legalName}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Purchase Info */}
              <Section title={t('exhibitors.purchaseInfo')}>
                <InfoRow label={t('exhibitors.buyer')} value={selected.buyerName ? `${selected.buyerName} (${selected.buyerEmail})` : selected.buyerEmail} />
                {selected.order?.orderNumber && <InfoRow label={t('exhibitors.orderNumber')} value={`#${selected.order.orderNumber}`} />}
                <InfoRow label={t('exhibitors.purchaseDate')} value={formatDate(selected.order?.purchaseDate ?? selected.createdAt)} />
                {selected.exhibitorCategory && <InfoRow label={t('exhibitors.category')} value={selected.exhibitorCategory} />}
                {selected.boothNumber && <InfoRow label={t('exhibitors.booth')} value={`#${selected.boothNumber}${selected.expoArea ? ` (${selected.expoArea})` : ''}`} />}
                <InfoRow label={t('exhibitors.status')} value={selected.status} />
              </Section>

              {/* Company Profile */}
              <Section title={t('exhibitors.companyProfile')}>
                {selected.profile.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2" dangerouslySetInnerHTML={{ __html: selected.profile.description }} />
                )}
                {selected.profile.website && <InfoRow label={t('exhibitors.website')} value={selected.profile.website} />}
                {selected.profile.contactEmail && <InfoRow label={t('exhibitors.contactEmail')} value={selected.profile.contactEmail} />}
                {selected.profile.contactPhone && <InfoRow label={t('exhibitors.contactPhone')} value={selected.profile.contactPhone} />}
                {selected.profile.socialLinks && Object.entries(selected.profile.socialLinks).map(([key, url]) => (
                  url ? <InfoRow key={key} label={key} value={url} /> : null
                ))}
              </Section>

              {/* Demo */}
              <Section title={t('exhibitors.demoDetails')}>
                {selected.demo.title ? (
                  <>
                    <InfoRow label={t('exhibitors.demoTitle')} value={selected.demo.title} />
                    {selected.demo.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1" dangerouslySetInnerHTML={{ __html: selected.demo.description }} />
                    )}
                    <div className="flex gap-3 mt-2 text-xs text-gray-500">
                      <span>{selected.demo.mediaCount} {t('exhibitors.media')}</span>
                      <span>{selected.demo.videoCount} {t('exhibitors.videos')}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">{t('exhibitors.noDemo')}</p>
                )}
              </Section>

              {/* Staff */}
              <Section title={`${t('exhibitors.staff')} (${selected.staffCount}/${selected.maxStaff > 0 ? selected.maxStaff : '∞'})`}>
                {selected.staff.length > 0 ? (
                  <div className="space-y-2">
                    {selected.staff.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm">
                        <div>
                          <span className="font-medium">{s.firstName} {s.lastName}</span>
                          <span className="text-gray-500 ml-2">{s.email}</span>
                          <span className="text-xs text-gray-400 ml-2">({s.role})</span>
                        </div>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: (PASS_STATUS_COLORS[s.passStatus] ?? '#94a3b8') + '20', color: PASS_STATUS_COLORS[s.passStatus] ?? '#94a3b8' }}
                        >
                          {s.passStatus}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">{t('exhibitors.noStaff')}</p>
                )}
              </Section>

              {/* Setup Request */}
              {selected.setupRequest && (
                <Section title={t('exhibitors.setupRequest')}>
                  <InfoRow label={t('exhibitors.setupStatus')} value={selected.setupRequest.status} />
                  {selected.setupRequest.submittedAt && <InfoRow label={t('exhibitors.submittedAt')} value={formatDate(selected.setupRequest.submittedAt)} />}
                  {selected.setupRequest.confirmedAt && <InfoRow label={t('exhibitors.confirmedAt')} value={formatDate(selected.setupRequest.confirmedAt)} />}
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 pb-1 border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
        {title}
      </h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex text-sm">
      <span className="text-gray-500 w-32 flex-shrink-0">{label}</span>
      <span className="text-gray-800 dark:text-gray-200 break-all">{value}</span>
    </div>
  );
}
