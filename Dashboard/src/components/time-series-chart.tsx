'use client';

import { useState, useMemo, useCallback } from 'react';
import { type TimeSeriesPoint } from '@/lib/api';
import { useI18n } from '@/i18n/i18n-provider';

// ── Series Configuration ────────────────────────────────────────

interface SeriesConfig {
  key: keyof Pick<TimeSeriesPoint, 'sales' | 'registrations' | 'memberships' | 'pageViews'>;
  labelKey: string;
  color: string;
  /** Transform the raw value for display (e.g. cents → CHF) */
  format: (v: number, currency: string) => string;
  /** Y-axis uses a secondary scale? */
  unit: 'currency' | 'count';
}

const SERIES_CONFIG: SeriesConfig[] = [
  {
    key: 'sales',
    labelKey: 'analytics.chart.sales',
    color: '#22c55e', // green
    format: (v, cur) =>
      `${(v / 100).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${cur}`,
    unit: 'currency',
  },
  {
    key: 'registrations',
    labelKey: 'analytics.chart.registrations',
    color: '#3b82f6', // blue
    format: (v) => v.toLocaleString(),
    unit: 'count',
  },
  {
    key: 'memberships',
    labelKey: 'analytics.chart.memberships',
    color: '#a855f7', // purple
    format: (v) => v.toLocaleString(),
    unit: 'count',
  },
  {
    key: 'pageViews',
    labelKey: 'analytics.chart.pageViews',
    color: '#f97316', // orange
    format: (v) => v.toLocaleString(),
    unit: 'count',
  },
];

// ── Date Range Presets ──────────────────────────────────────────

export type RangePreset = '7d' | '30d' | 'year' | 'all' | 'today';

interface RangeOption {
  key: RangePreset;
  labelKey: string;
}

const RANGE_CONFIG: RangeOption[] = [
  { key: 'today', labelKey: 'analytics.range.today' },
  { key: '7d', labelKey: 'analytics.range.7d' },
  { key: '30d', labelKey: 'analytics.range.30d' },
  { key: 'year', labelKey: 'analytics.range.year' },
  { key: 'all', labelKey: 'analytics.range.all' },
];

export function computeDateRange(
  preset: RangePreset,
  firstSaleDate: string | null,
): { from: string; to: string } {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: from.toISOString().split('T')[0], to: today };
    }
    case '30d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: from.toISOString().split('T')[0], to: today };
    }
    case 'year':
      return { from: `${now.getFullYear()}-01-01`, to: today };
    case 'all':
      return {
        from: firstSaleDate ?? `${now.getFullYear()}-01-01`,
        to: today,
      };
  }
}

// ── Chart Component ─────────────────────────────────────────────

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  currency: string;
  selectedRange: RangePreset;
  onRangeChange: (range: RangePreset) => void;
  loading?: boolean;
}

const CHART_PADDING = { top: 20, right: 20, bottom: 40, left: 60 };
const CHART_HEIGHT = 300;

export function TimeSeriesChart({
  data,
  currency,
  selectedRange,
  onRangeChange,
  loading,
}: TimeSeriesChartProps) {
  const { t } = useI18n();

  const series = useMemo(
    () => SERIES_CONFIG.map((s) => ({ ...s, label: t(s.labelKey) })),
    [t],
  );
  const rangeOptions = useMemo(
    () => RANGE_CONFIG.map((r) => ({ ...r, label: t(r.labelKey) })),
    [t],
  );

  const [enabledSeries, setEnabledSeries] = useState<Set<string>>(
    new Set(SERIES_CONFIG.map((s) => s.key)),
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const toggleSeries = useCallback((key: string) => {
    setEnabledSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow disabling all series
        if (next.size <= 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Filter enabled series configs
  const activeSeries = useMemo(
    () => series.filter((s) => enabledSeries.has(s.key)),
    [enabledSeries, series],
  );

  // Compute scales
  const { xPositions, yScales, chartWidth } = useMemo(() => {
    if (data.length === 0) {
      return { xPositions: [], yScales: new Map(), chartWidth: 600 };
    }

    const width = Math.max(600, data.length * 20);
    const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
    const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

    // X positions
    const xPos = data.map((_, i) =>
      CHART_PADDING.left +
      (data.length > 1 ? (i / (data.length - 1)) * plotWidth : plotWidth / 2),
    );

    // Compute Y scale per series (currency vs count may need different scales)
    const scales = new Map<string, { min: number; max: number; scale: (v: number) => number }>();

    // Group by unit type
    const currencySeries = activeSeries.filter((s) => s.unit === 'currency');
    const countSeries = activeSeries.filter((s) => s.unit === 'count');

    const computeScale = (seriesGroup: SeriesConfig[]) => {
      let globalMax = 0;
      for (const s of seriesGroup) {
        for (const d of data) {
          const v = d[s.key];
          if (v > globalMax) globalMax = v;
        }
      }
      // Add 10% headroom, ensure non-zero
      const max = globalMax > 0 ? globalMax * 1.1 : 10;
      return {
        min: 0,
        max,
        scale: (v: number) =>
          CHART_PADDING.top + plotHeight - (v / max) * plotHeight,
      };
    };

    if (currencySeries.length > 0) {
      const s = computeScale(currencySeries);
      for (const cs of currencySeries) scales.set(cs.key, s);
    }
    if (countSeries.length > 0) {
      const s = computeScale(countSeries);
      for (const cs of countSeries) scales.set(cs.key, s);
    }

    return { xPositions: xPos, yScales: scales, chartWidth: width };
  }, [data, activeSeries]);

  // Generate SVG paths
  const paths = useMemo(() => {
    if (data.length === 0) return [];

    return activeSeries.map((s) => {
      const scale = yScales.get(s.key);
      if (!scale) return { ...s, d: '', points: [] };

      const points = data.map((d, i) => ({
        x: xPositions[i],
        y: scale.scale(d[s.key]),
        value: d[s.key],
      }));

      // Build SVG path
      const d = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
        .join(' ');

      return { ...s, d, points };
    });
  }, [data, activeSeries, xPositions, yScales]);

  // X-axis labels (show every Nth label to avoid overlap)
  const xLabels = useMemo(() => {
    if (data.length === 0) return [];
    const step = Math.max(1, Math.ceil(data.length / 12));
    return data
      .map((d, i) => ({ index: i, date: d.date }))
      .filter((_, i) => i % step === 0 || i === data.length - 1);
  }, [data]);

  // Y-axis labels (left = primary scale)
  const yLabels = useMemo(() => {
    if (activeSeries.length === 0) return [];
    const first = activeSeries[0];
    const scale = yScales.get(first.key);
    if (!scale) return [];

    const ticks = 5;
    const step = scale.max / ticks;
    return Array.from({ length: ticks + 1 }, (_, i) => {
      const value = step * i;
      return {
        y: scale.scale(value),
        label:
          first.unit === 'currency'
            ? `${(value / 100).toLocaleString('de-CH', { maximumFractionDigits: 0 })}`
            : value.toLocaleString('de-CH', { maximumFractionDigits: 0 }),
      };
    });
  }, [activeSeries, yScales]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-CH', { day: '2-digit', month: 'short' });
  };

  return (
    <div
      className="rounded-xl"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Header: Title + Range Selector */}
      <div
        className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h2
          className="text-lg font-semibold"
          style={{ color: 'var(--color-text)' }}
        >
          {t('analytics.performanceOverview')}
        </h2>
        <div className="flex flex-wrap gap-1">
          {rangeOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onRangeChange(opt.key)}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background:
                  selectedRange === opt.key
                    ? 'var(--color-primary)'
                    : 'var(--color-bg-subtle)',
                color:
                  selectedRange === opt.key
                    ? '#fff'
                    : 'var(--color-text-secondary)',
                border:
                  selectedRange === opt.key
                    ? 'none'
                    : '1px solid var(--color-border)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Series toggles */}
      <div
        className="flex flex-wrap gap-3 border-b px-5 py-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {series.map((s) => {
          const active = enabledSeries.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggleSeries(s.key)}
              className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-all"
              style={{
                background: active ? `${s.color}18` : 'var(--color-bg-subtle)',
                color: active ? s.color : 'var(--color-text-muted)',
                border: active
                  ? `1.5px solid ${s.color}`
                  : '1.5px solid transparent',
                opacity: active ? 1 : 0.6,
              }}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: active ? s.color : 'var(--color-text-muted)' }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="relative px-5 py-4">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/50 dark:bg-black/30">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: 'var(--color-primary)' }} />
          </div>
        )}

        {data.length === 0 && !loading ? (
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t('analytics.noDataForRange')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <svg
              width={chartWidth}
              height={CHART_HEIGHT}
              viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
              className="w-full"
              style={{ minWidth: Math.min(chartWidth, 400) }}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Grid lines */}
              {yLabels.map((yl, i) => (
                <line
                  key={i}
                  x1={CHART_PADDING.left}
                  x2={chartWidth - CHART_PADDING.right}
                  y1={yl.y}
                  y2={yl.y}
                  stroke="var(--color-border)"
                  strokeWidth="0.5"
                  strokeDasharray="4 4"
                />
              ))}

              {/* Y-axis labels */}
              {yLabels.map((yl, i) => (
                <text
                  key={i}
                  x={CHART_PADDING.left - 8}
                  y={yl.y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--color-text-muted)"
                  fontFamily="inherit"
                >
                  {yl.label}
                </text>
              ))}

              {/* Lines */}
              {paths.map((p) => (
                <path
                  key={p.key}
                  d={p.d}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

              {/* Area fills (subtle) */}
              {paths.map((p) => {
                if (!p.points || p.points.length === 0) return null;
                const plotBottom = CHART_HEIGHT - CHART_PADDING.bottom;
                const areaD = `${p.d} L ${p.points[p.points.length - 1].x} ${plotBottom} L ${p.points[0].x} ${plotBottom} Z`;
                return (
                  <path
                    key={`area-${p.key}`}
                    d={areaD}
                    fill={p.color}
                    opacity="0.06"
                  />
                );
              })}

              {/* Hover line + dots */}
              {hoveredIndex !== null && xPositions[hoveredIndex] !== undefined && (
                <>
                  <line
                    x1={xPositions[hoveredIndex]}
                    x2={xPositions[hoveredIndex]}
                    y1={CHART_PADDING.top}
                    y2={CHART_HEIGHT - CHART_PADDING.bottom}
                    stroke="var(--color-text-muted)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.5"
                  />
                  {paths.map((p) => {
                    const pt = p.points?.[hoveredIndex];
                    if (!pt) return null;
                    return (
                      <circle
                        key={`dot-${p.key}`}
                        cx={pt.x}
                        cy={pt.y}
                        r="4"
                        fill={p.color}
                        stroke="#fff"
                        strokeWidth="2"
                      />
                    );
                  })}
                </>
              )}

              {/* X-axis labels */}
              {xLabels.map(({ index, date }) => (
                <text
                  key={date}
                  x={xPositions[index]}
                  y={CHART_HEIGHT - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--color-text-muted)"
                  fontFamily="inherit"
                >
                  {formatDate(date)}
                </text>
              ))}

              {/* Invisible hover rects for each data point */}
              {data.map((_, i) => {
                const x0 =
                  i === 0
                    ? CHART_PADDING.left
                    : (xPositions[i - 1] + xPositions[i]) / 2;
                const x1 =
                  i === data.length - 1
                    ? chartWidth - CHART_PADDING.right
                    : (xPositions[i] + xPositions[i + 1]) / 2;
                return (
                  <rect
                    key={i}
                    x={x0}
                    y={CHART_PADDING.top}
                    width={Math.max(x1 - x0, 1)}
                    height={CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom}
                    fill="transparent"
                    onMouseEnter={() => setHoveredIndex(i)}
                  />
                );
              })}
            </svg>
          </div>
        )}

        {/* Tooltip */}
        {hoveredIndex !== null && data[hoveredIndex] && (
          <div
            className="pointer-events-none absolute z-20 rounded-lg px-4 py-3 text-xs shadow-lg"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              left: Math.min(
                xPositions[hoveredIndex] + 60,
                chartWidth - 180,
              ),
              top: 40,
            }}
          >
            <p
              className="mb-2 font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              {new Date(data[hoveredIndex].date).toLocaleDateString('en-CH', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </p>
            {activeSeries.map((s) => (
              <div
                key={s.key}
                className="flex items-center gap-2 py-0.5"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {s.label}:
                </span>
                <span
                  className="font-semibold"
                  style={{ color: 'var(--color-text)' }}
                >
                  {s.format(data[hoveredIndex][s.key], currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
