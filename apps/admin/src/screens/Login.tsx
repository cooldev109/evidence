import { useState } from 'react';
import { useIntl } from 'react-intl';
import { api, setToken } from '../api.ts';

export function Login({ onLogin }: { onLogin: (tenantLocale: string) => void }) {
  const intl = useIntl();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(false);
    setBusy(true);
    try {
      const res = await api.login(email, password);
      setToken(res.token);
      let tenantLocale = 'pt-BR';
      try {
        const me = await api.me();
        tenantLocale = me.tenant?.locale ?? 'pt-BR';
      } catch {
        /* ignore */
      }
      onLogin(tenantLocale);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-brand">
        <div className="mark">EVIDENCE</div>
        <h1>Digital chain of custody</h1>
        <p>
          Tamper-evident events, RFC 3161 timestamps, append-only evidence, and court-ready proof —
          verifiable by anyone.
        </p>
        <div className="badges">
          <span className="chip">SHA-256 hash chain</span>
          <span className="chip">RFC 3161 TSA</span>
          <span className="chip">Append-only storage</span>
          <span className="chip">PT · EN · ES</span>
        </div>
      </div>
      <div className="login-form-wrap">
        <div className="login-card">
          <h2>{intl.formatMessage({ id: 'login.title' })}</h2>
          <p className="hint">{intl.formatMessage({ id: 'login.email' })} · {intl.formatMessage({ id: 'login.password' })}</p>
          <form onSubmit={submit}>
            <label>
              {intl.formatMessage({ id: 'login.email' })}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            <label>
              {intl.formatMessage({ id: 'login.password' })}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="error">{intl.formatMessage({ id: 'login.error' })}</p>}
            <button type="submit" disabled={busy}>
              {intl.formatMessage({ id: 'login.submit' })}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
