import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { api, ApiError, type AppUserRow } from '../api.ts';

export function Users() {
  const intl = useIntl();
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.users().then((r) => setUsers(r.users)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createUser(email, password, name);
      setEmail('');
      setName('');
      setPassword('');
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? intl.formatMessage({ id: 'users.emailTaken' })
          : 'Error',
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (u: AppUserRow) => {
    await api.setUserDisabled(u.id, !u.disabledAt);
    await load();
  };

  return (
    <div>
      <h1>
        <FormattedMessage id="users.title" />
      </h1>
      <p className="subtitle">
        <FormattedMessage id="users.subtitle" />
      </p>

      <div className="card" style={{ marginBottom: 24 }}>
        <form className="form" onSubmit={create}>
          <label>
            <FormattedMessage id="users.email" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            <FormattedMessage id="users.name" />
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <FormattedMessage id="users.password" />
            <input
              type="password"
              value={password}
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            <FormattedMessage id="users.create" />
          </button>
          {error && <span className="error">{error}</span>}
        </form>
      </div>

      {users.length === 0 ? (
        <div className="empty">
          <FormattedMessage id="users.empty" />
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>{intl.formatMessage({ id: 'users.email' })}</th>
              <th>{intl.formatMessage({ id: 'users.name' })}</th>
              <th>{intl.formatMessage({ id: 'users.lastLogin' })}</th>
              <th>{intl.formatMessage({ id: 'users.status' })}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.name || '—'}</td>
                <td>
                  {u.lastLoginAt
                    ? new Date(u.lastLoginAt).toLocaleString(intl.locale)
                    : intl.formatMessage({ id: 'users.never' })}
                </td>
                <td>
                  <span className={u.disabledAt ? 'badge bad' : 'badge ok'}>
                    <FormattedMessage id={u.disabledAt ? 'users.disabled' : 'users.active'} />
                  </span>
                </td>
                <td>
                  <button
                    className={u.disabledAt ? 'link' : 'link danger'}
                    onClick={() => toggle(u)}
                  >
                    <FormattedMessage id={u.disabledAt ? 'users.enable' : 'users.disable'} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
