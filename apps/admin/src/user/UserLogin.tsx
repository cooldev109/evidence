import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { Locale } from '../i18n.ts';
import { userApi, setUserToken } from './userApi.ts';

interface Props {
  onLogin: (tenantLocale: string) => void;
  locale: Locale;
  locales: Locale[];
  onLocale: (l: Locale) => void;
}

export function UserLogin({ onLogin, locale, locales, onLocale }: Props) {
  const intl = useIntl();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setBusy(true);
    try {
      const res = await userApi.login(email, password);
      setUserToken(res.token);
      const me = await userApi.me().catch(() => null);
      onLogin(me?.tenant?.locale ?? 'pt-BR');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="u-login">
      <div className="u-login-card">
        <div className="u-login-brand">
          <div className="brand-logo lg">E</div>
          <h1>EVIDENCE</h1>
          <p>
            <FormattedMessage id="u.login.subtitle" />
          </p>
        </div>
        <form onSubmit={submit}>
          <label>
            <FormattedMessage id="u.login.email" />
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            <FormattedMessage id="u.login.password" />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div className="u-error">
              <FormattedMessage id="u.login.error" />
            </div>
          )}
          <button type="submit" className="u-btn-primary" disabled={busy}>
            {intl.formatMessage({ id: 'u.login.submit' })}
          </button>
        </form>
        <div className="u-login-locale">
          <select value={locale} onChange={(e) => onLocale(e.target.value as Locale)}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
