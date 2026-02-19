'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api, type SettingValue } from '@/lib/api';

/** Group order for display. */
const GROUP_ORDER = [
  'Stripe',
  'Email',
  'WordPress',
  'Security',
  'Infrastructure',
  'General',
];

export default function SettingsPage() {
  const { hasRole } = useAuth();
  const [settings, setSettings] = useState<SettingValue[]>([]);
  const [groups, setGroups] = useState<Record<string, SettingValue[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  // Track edits: key → new value (only changed fields)
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Track which secret fields are revealed
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.getSettings();
      setSettings(data.settings);
      setGroups(data.groups);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Auto-dismiss messages
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  if (!hasRole('super_admin')) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        <span className="text-4xl">🔒</span>
        <p
          className="mt-4 text-lg font-medium"
          style={{ color: 'var(--color-text)' }}
        >
          Access Denied
        </p>
        <p
          className="mt-1 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Only Super Admins can access platform settings.
        </p>
      </div>
    );
  }

  const hasChanges = Object.keys(edits).length > 0;

  const handleChange = (key: string, value: string) => {
    setEdits((prev) => {
      // Find original value
      const original = settings.find((s) => s.key === key);
      const originalValue = original?.value ?? '';
      // If the user reverted to original, remove from edits
      if (value === originalValue) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setMessage(null);

    try {
      const updates = Object.entries(edits).map(([key, value]) => ({
        key,
        value,
      }));
      const result = await api.updateSettings(updates);

      if (result.requiresRestart) {
        setMessage({
          type: 'warning',
          text: `${result.updated.length} setting(s) saved. Some changes require a server restart to take effect.`,
        });
      } else {
        setMessage({
          type: 'success',
          text: `${result.updated.length} setting(s) saved successfully.`,
        });
      }

      setEdits({});
      setRevealed(new Set());
      await loadSettings();
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.message ?? 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setEdits({});
    setRevealed(new Set());
  };

  const toggleReveal = (key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (loading) {
    return <LoadingSkeleton />;
  }

  const sortedGroups = GROUP_ORDER.filter((g) => groups[g]?.length > 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: 'var(--color-text)' }}
          >
            Settings
          </h1>
          <p
            className="mt-1 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Platform configuration — values stored in the database override .env
            file settings
          </p>
        </div>
        <div className="flex gap-2">
          {hasChanges && (
            <button
              onClick={handleDiscard}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ background: hasChanges ? 'var(--color-primary)' : 'var(--color-bg-muted)' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          className="mb-6 rounded-lg px-4 py-3 text-sm font-medium"
          style={{
            background:
              message.type === 'success'
                ? 'var(--color-success-bg, #d1fae5)'
                : message.type === 'warning'
                  ? 'var(--color-warning-bg, #fef3c7)'
                  : 'var(--color-error-bg, #fee2e2)',
            color:
              message.type === 'success'
                ? 'var(--color-success-text, #065f46)'
                : message.type === 'warning'
                  ? 'var(--color-warning-text, #92400e)'
                  : 'var(--color-error-text, #991b1b)',
          }}
        >
          {message.type === 'success' && '✓ '}
          {message.type === 'warning' && '⚠ '}
          {message.type === 'error' && '✕ '}
          {message.text}
        </div>
      )}

      {/* Unsaved Changes Banner */}
      {hasChanges && (
        <div
          className="mb-6 rounded-lg px-4 py-3 text-sm"
          style={{
            background: 'var(--color-primary-light, #eff6ff)',
            color: 'var(--color-primary)',
            border: '1px solid var(--color-primary)',
          }}
        >
          You have {Object.keys(edits).length} unsaved change
          {Object.keys(edits).length !== 1 ? 's' : ''}.
        </div>
      )}

      {/* Settings Groups */}
      <div className="space-y-6">
        {sortedGroups.map((groupName) => (
          <SettingsGroup
            key={groupName}
            name={groupName}
            settings={groups[groupName]}
            edits={edits}
            revealed={revealed}
            onChange={handleChange}
            onToggleReveal={toggleReveal}
          />
        ))}
      </div>

      {/* Legend */}
      <div
        className="mt-8 rounded-lg p-4 text-xs"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
        }}
      >
        <p className="mb-2 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
          Source indicators:
        </p>
        <div className="flex flex-wrap gap-4">
          <span>
            <SourceBadge source="database" /> Stored in database (overrides .env)
          </span>
          <span>
            <SourceBadge source="env" /> Read from .env file
          </span>
          <span>
            <SourceBadge source="default" /> Not configured
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Settings Group ──────────────────────────────────────────────

const GROUP_ICONS: Record<string, string> = {
  Stripe: '💳',
  Email: '📧',
  WordPress: '🔌',
  Security: '🔐',
  Infrastructure: '🏗️',
  General: '⚙️',
};

function SettingsGroup({
  name,
  settings,
  edits,
  revealed,
  onChange,
  onToggleReveal,
}: {
  name: string;
  settings: SettingValue[];
  edits: Record<string, string>;
  revealed: Set<string>;
  onChange: (key: string, value: string) => void;
  onToggleReveal: (key: string) => void;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div
        className="border-b px-5 py-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h2
          className="flex items-center gap-2 text-base font-semibold"
          style={{ color: 'var(--color-text)' }}
        >
          <span>{GROUP_ICONS[name] ?? '📦'}</span>
          {name}
        </h2>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {settings.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            editValue={edits[setting.key]}
            isRevealed={revealed.has(setting.key)}
            onChange={(value) => onChange(setting.key, value)}
            onToggleReveal={() => onToggleReveal(setting.key)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Setting Row ─────────────────────────────────────────────────

function SettingRow({
  setting,
  editValue,
  isRevealed,
  onChange,
  onToggleReveal,
}: {
  setting: SettingValue;
  editValue?: string;
  isRevealed: boolean;
  onChange: (value: string) => void;
  onToggleReveal: () => void;
}) {
  const currentValue = editValue ?? setting.value;
  const isEdited = editValue !== undefined;
  const isSensitive = setting.sensitive;

  return (
    <div className="px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        {/* Label & Description */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <label
              className="text-sm font-medium"
              style={{ color: 'var(--color-text)' }}
            >
              {setting.label}
            </label>
            <SourceBadge source={isEdited ? 'database' : setting.source} />
            {setting.required && (
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--color-error, #ef4444)' }}
              >
                Required
              </span>
            )}
          </div>
          <p
            className="mt-0.5 text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {setting.description}
          </p>
          <p
            className="mt-0.5 text-[10px] font-mono"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {setting.envVar}
          </p>
        </div>

        {/* Input */}
        <div className="w-full sm:w-80">
          <div className="relative flex">
            {setting.type === 'boolean' ? (
              <select
                value={currentValue}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{
                  background: 'var(--color-bg-subtle)',
                  border: isEdited
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                <option value="">Not set</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={
                  isSensitive && !isRevealed && !isEdited ? 'password' : 'text'
                }
                value={currentValue}
                onChange={(e) => onChange(e.target.value)}
                placeholder={setting.isSet ? '(unchanged)' : 'Not configured'}
                className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                style={{
                  background: 'var(--color-bg-subtle)',
                  border: isEdited
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
            )}
            {isSensitive && !isEdited && setting.type !== 'boolean' && (
              <button
                type="button"
                onClick={onToggleReveal}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'var(--color-text-muted)' }}
                title={isRevealed ? 'Hide' : 'Reveal'}
              >
                {isRevealed ? '🙈' : '👁️'}
              </button>
            )}
          </div>
          {isEdited && (
            <p
              className="mt-1 text-xs"
              style={{ color: 'var(--color-primary)' }}
            >
              Modified — save to apply
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Source Badge ─────────────────────────────────────────────────

function SourceBadge({ source }: { source: 'database' | 'env' | 'default' }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    database: {
      bg: 'var(--color-success-bg, #d1fae5)',
      color: 'var(--color-success-text, #065f46)',
      label: 'DB',
    },
    env: {
      bg: 'var(--color-info-bg, #dbeafe)',
      color: 'var(--color-info-text, #1e40af)',
      label: '.env',
    },
    default: {
      bg: 'var(--color-bg-muted, #f3f4f6)',
      color: 'var(--color-text-muted, #9ca3af)',
      label: '—',
    },
  };

  const s = styles[source] ?? styles.default;

  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

// ── Loading Skeleton ────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <div
          className="h-8 w-32 animate-pulse rounded"
          style={{ background: 'var(--color-bg-muted)' }}
        />
        <div
          className="mt-2 h-4 w-64 animate-pulse rounded"
          style={{ background: 'var(--color-bg-muted)' }}
        />
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="mb-4 h-40 animate-pulse rounded-xl"
          style={{ background: 'var(--color-bg-muted)' }}
        />
      ))}
    </div>
  );
}
