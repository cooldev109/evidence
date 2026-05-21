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
      // fetch tenant locale to default the UI language
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
      <form className="card login-card" onSubmit={submit}>
        <h1>EVIDENCE</h1>
        <h2>{intl.formatMessage({ id: 'login.title' })}</h2>
        <label>
          {intl.formatMessage({ id: 'login.email' })}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {intl.formatMessage({ id: 'login.password' })}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{intl.formatMessage({ id: 'login.error' })}</p>}
        <button type="submit" disabled={busy}>
          {intl.formatMessage({ id: 'login.submit' })}
        </button>
      </form>
    </div>
  );
}
