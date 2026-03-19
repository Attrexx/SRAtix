'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { api, type AppUser, type RoleDefinition, type UserStats } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Icons } from '@/components/icons';
import { useI18n } from '@/i18n/i18n-provider';

interface CreateFormData {
  email: string;
  displayName: string;
  password: string;
  roles: string[];
}

export default function UsersPage() {
  const { hasRole } = useAuth();
  const { t } = useI18n();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'active' | 'inactive'>('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Filter users client-side
  const filteredUsers = useMemo(() => {
    let result = users;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    if (filterRole) {
      result = result.filter((u) => u.roles.includes(filterRole));
    }
    if (filterStatus === 'active') {
      result = result.filter((u) => u.active);
    } else if (filterStatus === 'inactive') {
      result = result.filter((u) => !u.active);
    }
    return result;
  }, [users, debouncedSearch, filterRole, filterStatus]);

  const hasActiveFilters = !!searchQuery || !!filterRole || !!filterStatus;

  const clearFilters = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    setFilterRole('');
    setFilterStatus('');
  };

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([api.getUsers(), api.getAvailableRoles()])
      .then(([u, r]) => {
        setUsers(u);
        setRoles(r);
      })
      .catch(() => setError(t('users.failedToLoad')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!hasRole('super_admin') && !hasRole('admin')) {
    return (
      <div className="py-16 text-center">
        <span className="opacity-30" style={{ color: 'var(--color-text)' }}><Icons.Lock size={48} /></span>
        <p className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>
          {t('users.accessDenied')}
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('users.accessDeniedHint')}
        </p>
      </div>
    );
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <div>
      {/* Super Admin Stats Panel */}
      {hasRole('super_admin') && <SuperAdminPanel />}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            {t('users.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('users.subtitle')}
          </p>
        </div>
        <button
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          style={{ background: 'var(--color-primary)' }}
          onClick={() => { setShowCreate(true); setEditingId(null); }}
        >
          {t('users.newUser')}
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div
          className="mb-4 rounded-lg px-4 py-2 text-sm"
          style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="mb-4 rounded-lg px-4 py-2 text-sm"
          style={{ background: 'var(--color-success-light, #dcfce7)', color: 'var(--color-success, #16a34a)' }}
        >
          {success}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showCreate && (
        <CreateUserModal
          roles={roles}
          onClose={() => setShowCreate(false)}
          onCreated={(msg) => {
            setSuccess(msg);
            setShowCreate(false);
            loadData();
            setTimeout(() => setSuccess(''), 5000);
          }}
          onError={setError}
        />
      )}

      {editingId && (
        <EditUserModal
          userId={editingId}
          roles={roles}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setSuccess(t('users.userUpdated'));
            setEditingId(null);
            loadData();
            setTimeout(() => setSuccess(''), 5000);
          }}
          onError={setError}
        />
      )}

      {/* Search & Filter Bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Icons.Search size={16} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('users.search.placeholder')}
            className="w-full rounded-lg py-2 pl-9 pr-3 text-sm"
            style={{
              background: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
        </div>

        {/* Role filter */}
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            minWidth: '150px',
          }}
        >
          <option value="">{t('users.filter.allRoles')}</option>
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as '' | 'active' | 'inactive')}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            minWidth: '130px',
          }}
        >
          <option value="">{t('users.filter.allStatuses')}</option>
          <option value="active">{t('users.filter.active')}</option>
          <option value="inactive">{t('users.filter.inactive')}</option>
        </select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="rounded-lg px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-muted)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {t('users.filter.clear')}
          </button>
        )}
      </div>

      {/* Users Table */}
      <div
        className="overflow-x-auto rounded-xl"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        <table className="w-full text-left text-sm" style={{ minWidth: '640px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th className="px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('users.column.user')}</th>
              <th className="px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('users.column.roles')}</th>
              <th className="px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('users.column.status')}</th>
              <th className="px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('users.column.lastLogin')}</th>
              <th className="px-4 py-3 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('users.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                onEdit={() => setEditingId(user.id)}
                onToggleActive={async () => {
                  try {
                    if (user.active) {
                      await api.deactivateUser(user.id);
                    } else {
                      await api.activateUser(user.id);
                    }
                    loadData();
                  } catch {
                    setError(t('users.failedToUpdateStatus'));
                  }
                }}
              />
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p style={{ color: 'var(--color-text-muted)' }}>{t('users.noUsersYet')}</p>
          </div>
        )}

        {users.length > 0 && filteredUsers.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p style={{ color: 'var(--color-text-muted)' }}>{t('users.noResults')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User Table Row ─────────────────────────────────────────────

function UserRow({
  user,
  onEdit,
  onToggleActive,
}: {
  user: AppUser;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const { t } = useI18n();
  const { hasRole } = useAuth();

  // Hierarchy-based button visibility: admin users cannot manage same-rank or higher
  const isActorAdmin = hasRole('admin') && !hasRole('super_admin');
  const targetHasHighRank = user.roles.some((r) => r === 'super_admin' || r === 'admin');
  const canManage = !isActorAdmin || !targetHasHighRank;

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td className="px-4 py-3">
        <div>
          <p className="font-medium" style={{ color: 'var(--color-text)' }}>
            {user.displayName}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {user.email}
          </p>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <span
              key={role}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: role === 'super_admin' || role === 'admin' ? 'var(--color-primary-light)' : 'var(--color-bg-muted)',
                color: role === 'super_admin' || role === 'admin' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              }}
            >
              {role.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            background: user.active
              ? 'var(--color-success-light, #dcfce7)'
              : 'var(--color-danger-light)',
            color: user.active
              ? 'var(--color-success, #16a34a)'
              : 'var(--color-danger)',
          }}
        >
          {user.active ? t('common.active') : t('common.inactive')}
        </span>
        {user.wpUserId && (
          <span
            className="ml-1 rounded-full px-2 py-0.5 text-xs"
            style={{ background: 'var(--color-bg-muted)', color: 'var(--color-text-muted)' }}
          >
            {t('users.badge.wp')}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {user.lastLoginAt
          ? new Date(user.lastLoginAt).toLocaleDateString('en-CH', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : t('common.never')}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          {canManage && (
            <button
              onClick={onEdit}
              className="rounded px-2 py-1 text-xs transition-colors"
              style={{ color: 'var(--color-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-primary-light)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {t('common.edit')}
            </button>
          )}
          {canManage && (
            <button
              onClick={onToggleActive}
              className="rounded px-2 py-1 text-xs transition-colors"
              style={{ color: user.active ? 'var(--color-danger)' : 'var(--color-success, #16a34a)' }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = user.active
                  ? 'var(--color-danger-light)'
                  : 'var(--color-success-light, #dcfce7)')
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {user.active ? t('common.deactivate') : t('common.activate')}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Create User Modal ──────────────────────────────────────────

function CreateUserModal({
  roles,
  onClose,
  onCreated,
  onError,
}: {
  roles: RoleDefinition[];
  onClose: () => void;
  onCreated: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<CreateFormData>({
    email: '',
    displayName: '',
    password: '',
    roles: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [genPassword, setGenPassword] = useState('');

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789_-';
    let pw = '';
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    for (const b of arr) pw += chars[b % chars.length];
    setGenPassword(pw);
    setForm((f) => ({ ...f, password: pw }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.displayName || !form.password || form.roles.length === 0) {
      onError(t('common.allFields'));
      return;
    }
    setSubmitting(true);
    try {
      await api.createUser(form);
      const credMsg = genPassword
        ? `User created. Credentials: ${form.email} / ${genPassword}`
        : `User created: ${form.email}`;
      onCreated(credMsg);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('users.failedToCreate'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="w-full max-w-lg rounded-2xl p-6"
        style={{
          background: 'var(--color-bg-card)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
            {t('users.createUser')}
          </h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--color-text-muted)' }}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FieldInput label={t('users.form.email')} type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          <FieldInput label={t('users.form.displayName')} value={form.displayName} onChange={(v) => setForm((f) => ({ ...f, displayName: v }))} />

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('users.form.password')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.password}
                onChange={(e) => { setForm((f) => ({ ...f, password: e.target.value })); setGenPassword(''); }}
                className="flex-1 rounded-lg px-3 py-2 text-sm"
                style={{
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontFamily: 'monospace',
                }}
                placeholder={t('users.form.passwordPlaceholder')}
              />
              <button
                type="button"
                onClick={generatePassword}
                className="rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                style={{
                  background: 'var(--color-bg-muted)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {t('common.generate')}
              </button>
            </div>
            {genPassword && (
              <p className="mt-1 text-xs font-mono" style={{ color: 'var(--color-primary)' }}>
                {t('users.form.savePasswordHint')}
              </p>
            )}
          </div>

          {/* Role selector */}
          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('users.form.roles')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => toggleRole(role.value)}
                  className="rounded-lg px-3 py-2 text-left text-sm transition-colors"
                  style={{
                    background: form.roles.includes(role.value) ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)',
                    border: `1px solid ${form.roles.includes(role.value) ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    color: form.roles.includes(role.value) ? 'var(--color-primary)' : 'var(--color-text)',
                  }}
                >
                  <span className="font-medium">{role.label}</span>
                  <br />
                  <span className="text-xs opacity-70">{role.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {submitting ? t('common.creating') : t('users.createUser')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit User Modal ────────────────────────────────────────────

function EditUserModal({
  userId,
  roles: availableRoles,
  onClose,
  onSaved,
  onError,
}: {
  userId: string;
  roles: RoleDefinition[];
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    api
      .getUser(userId)
      .then((u) => {
        setUser(u);
        setEmail(u.email);
        setDisplayName(u.displayName);
        setSelectedRoles(u.roles);
      })
      .catch(() => onError(t('users.failedToLoadUser')));
  }, [userId, onError, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const data: Record<string, unknown> = {};
      if (email !== user?.email) data.email = email;
      if (displayName !== user?.displayName) data.displayName = displayName;
      if (password) data.password = password;
      if (JSON.stringify(selectedRoles.sort()) !== JSON.stringify(user?.roles.sort())) {
        data.roles = selectedRoles;
      }
      await api.updateUser(userId, data);
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('users.failedToUpdate'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  if (!user) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="animate-spin" style={{ color: 'var(--color-primary)' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="w-full max-w-lg rounded-2xl p-6"
        style={{
          background: 'var(--color-bg-card)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
            {t('users.editUser')}
          </h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--color-text-muted)' }}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FieldInput label={t('users.form.email')} type="email" value={email} onChange={setEmail} />
          <FieldInput label={t('users.form.displayName')} value={displayName} onChange={setDisplayName} />
          <FieldInput
            label={t('users.form.newPassword')}
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={t('users.form.newPasswordPlaceholder')}
          />

          {/* Role selector */}
          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('users.form.roles')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {availableRoles.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => toggleRole(role.value)}
                  className="rounded-lg px-3 py-2 text-left text-sm transition-colors"
                  style={{
                    background: selectedRoles.includes(role.value) ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)',
                    border: `1px solid ${selectedRoles.includes(role.value) ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    color: selectedRoles.includes(role.value) ? 'var(--color-primary)' : 'var(--color-text)',
                  }}
                >
                  <span className="font-medium">{role.label}</span>
                  <br />
                  <span className="text-xs opacity-70">{role.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {submitting ? t('common.saving') : t('common.saveChanges')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────

function FieldInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
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

// ─── Super Admin Stats Panel ────────────────────────────────────

function SuperAdminPanel() {
  const { t } = useI18n();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsError, setStatsError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fetchStats = () => {
      api.getUserStats()
        .then((data) => { if (!cancelled) setStats(data); })
        .catch(() => { if (!cancelled) setStatsError('Failed to load stats'); });
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (statsError) return null; // Silently hide on error
  if (!stats) {
    return (
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl" style={{ background: 'var(--color-bg-muted)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
        {t('users.stats.title')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Active Users */}
        <div
          className="rounded-xl p-4"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('users.stats.activeUsers')}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{
                background: stats.activeUsers.length > 0 ? 'var(--color-success-light, #dcfce7)' : 'var(--color-bg-muted)',
                color: stats.activeUsers.length > 0 ? 'var(--color-success, #16a34a)' : 'var(--color-text-muted)',
              }}
            >
              {stats.activeUsers.length} {t('users.stats.activeNow')}
            </span>
          </div>
          {stats.activeUsers.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('users.stats.noActiveUsers')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {stats.activeUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>{u.displayName}</span>
                  <div className="flex gap-1">
                    {u.roles.map((r) => (
                      <span
                        key={r}
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          background: r === 'super_admin' || r === 'admin' ? 'var(--color-primary-light)' : 'var(--color-bg-muted)',
                          color: r === 'super_admin' || r === 'admin' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        }}
                      >
                        {r.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Login History */}
        <div
          className="rounded-xl p-4"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div className="mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('users.stats.loginHistory')}
            </span>
            <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('users.stats.loginHistoryDesc')}
            </span>
          </div>
          {stats.loginHistory.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('users.stats.noLoginHistory')}
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {stats.loginHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded px-2 py-1 text-xs"
                  style={{ background: 'var(--color-bg-subtle)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                      {entry.displayName}
                    </span>
                    {entry.roles.slice(0, 1).map((r) => (
                      <span
                        key={r}
                        className="rounded-full px-1.5 py-0.5 text-[10px]"
                        style={{
                          background: r === 'super_admin' || r === 'admin' ? 'var(--color-primary-light)' : 'var(--color-bg-muted)',
                          color: r === 'super_admin' || r === 'admin' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        }}
                      >
                        {r.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(entry.timestamp).toLocaleDateString('en-CH', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Never Logged In Count */}
        <div
          className="rounded-xl p-4"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('users.stats.neverLoggedIn')}
          </span>
          <p
            className="mt-2 text-3xl font-bold"
            style={{ color: stats.neverLoggedInCount > 0 ? 'var(--color-warning, #d97706)' : 'var(--color-text)' }}
          >
            {stats.neverLoggedInCount}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('users.stats.neverLoggedInDesc')}
          </p>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-8 w-48 animate-pulse rounded" style={{ background: 'var(--color-bg-muted)' }} />
        <div className="mt-2 h-4 w-56 animate-pulse rounded" style={{ background: 'var(--color-bg-muted)' }} />
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl" style={{ background: 'var(--color-bg-muted)' }} />
        ))}
      </div>
    </div>
  );
}
