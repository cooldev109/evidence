import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import type { Locale } from '../i18n.ts';
import { getAtaForSigning, signAta, type AtaSignView } from './userApi.ts';
import { IconShield, IconSun, IconMoon } from '../icons.tsx';
import { useTheme } from '../lib/useTheme.ts';

interface Props {
  locale: Locale;
  locales: Locale[];
  onLocale: (l: Locale) => void;
}

export function AtaSign({ locale, locales, onLocale }: Props) {
  const intl = useIntl();
  const { token } = useParams<{ token: string }>();
  const { theme, toggle: toggleTheme } = useTheme();
  const [view, setView] = useState<AtaSignView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    getAtaForSigning(token)
      .then((v) => {
        setView(v);
        setName(v.signer.name ?? '');
        if (v.signed) setDone(true);
      })
      .catch(() => setNotFound(true));
  }, [token]);

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await signAta(token, name);
      setDone(true);
    } catch {
      setNotFound(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="u-login">
      <div className="u-login-card u-sign-card">
        <div className="u-sign-toprow">
          <button
            type="button"
            className="u-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <select className="locale-select" value={locale} onChange={(e) => onLocale(e.target.value as Locale)}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {notFound ? (
          <div className="u-empty">
            <p>
              <FormattedMessage id="u.sign.notFound" />
            </p>
          </div>
        ) : !view ? (
          <div className="u-skeleton-card lg" />
        ) : done ? (
          <div className="u-sign-done">
            <IconShield />
            <h2>{view.ata?.title}</h2>
            <p className="u-sealed-banner" style={{ justifyContent: 'center' }}>
              <FormattedMessage id={view.signed ? 'u.sign.already' : 'u.sign.done'} />
            </p>
          </div>
        ) : (
          <>
            <div className="u-login-brand" style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 20 }}>
                <FormattedMessage id="u.sign.title" />
              </h1>
              <p>
                <FormattedMessage id="u.sign.intro" />
              </p>
            </div>

            {view.ata && (
              <>
                <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>{view.ata.title}</h2>
                <dl className="u-detail-list">
                  {view.ata.organization && (
                    <div>
                      <dt>
                        <FormattedMessage id="u.sign.org" />
                      </dt>
                      <dd>{view.ata.organization}</dd>
                    </div>
                  )}
                  <div>
                    <dt>
                      <FormattedMessage id="u.sign.capturedAt" />
                    </dt>
                    <dd>{new Date(view.ata.capturedAt).toLocaleString(intl.locale)}</dd>
                  </div>
                </dl>
                {view.ata.transcript && (
                  <div className="u-transcript">
                    <div className="u-transcript-head">
                      <FormattedMessage id="u.sign.transcript" />
                    </div>
                    <p>{view.ata.transcript}</p>
                  </div>
                )}
              </>
            )}

            <label className="u-field">
              <FormattedMessage id="u.sign.yourName" />
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="u-btn-primary" onClick={submit} disabled={busy}>
              <FormattedMessage id={busy ? 'u.sign.signing' : 'u.sign.button'} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
