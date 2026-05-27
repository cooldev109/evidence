import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import type { Locale } from '../i18n.ts';
import {
  getAtaForSigning,
  signAta,
  ApiError,
  type AtaSignView,
  type CaptureGeo,
} from './userApi.ts';
import { IconShield, IconSun, IconMoon, IconPin } from '../icons.tsx';
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
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<CaptureGeo | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'ok' | 'denied'>('idle');

  useEffect(() => {
    if (!token) return;
    getAtaForSigning(token)
      .then((v) => {
        setView(v);
        setName(v.signer.name ?? '');
        if (v.signed) setDone(true);
      })
      .catch(() => setNotFound(true));
    requestLocation();
  }, [token]);

  function requestLocation() {
    if (!('geolocation' in navigator)) return;
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGeoState('ok');
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  const submit = async () => {
    if (!token || !view) return;
    setError(null);
    // If the owner registered an email for this signer, the typed email is
    // required and must match.
    if (view.signer.hasEmailOnFile && !email.trim()) {
      setError(intl.formatMessage({ id: 'u.sign.emailRequired' }));
      return;
    }
    setBusy(true);
    try {
      await signAta(token, {
        name,
        email: email.trim() || undefined,
        cpf: cpf.trim() || undefined,
        geo,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; detail?: string } | null;
        if (err.status === 403 && body?.error === 'email_mismatch') {
          setError(intl.formatMessage({ id: 'u.sign.emailMismatch' }));
        } else if (err.status === 400 && body?.error === 'email_required') {
          setError(intl.formatMessage({ id: 'u.sign.emailRequired' }));
        } else if (err.status === 404) {
          setNotFound(true);
        } else {
          setError(body?.detail || intl.formatMessage({ id: 'u.sign.error' }));
        }
      } else {
        setError(intl.formatMessage({ id: 'u.sign.error' }));
      }
    } finally {
      setBusy(false);
    }
  };

  function maskEmail(e: string): string {
    const [user, domain] = e.split('@');
    if (!user || !domain) return e;
    const u = user.length <= 2 ? user[0] + '*' : user[0] + '***' + user[user.length - 1];
    const d = domain.replace(/(?<=.{1}).(?=.*\.)/g, '*');
    return `${u}@${d}`;
  }

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

            {view.signer.hasEmailOnFile && view.signer.email && (
              <div className="u-sign-identity-hint">
                <FormattedMessage id="u.sign.signingAs" />{' '}
                <strong>{maskEmail(view.signer.email)}</strong>
              </div>
            )}

            <label className="u-field">
              <FormattedMessage id="u.sign.yourName" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>

            {view.signer.hasEmailOnFile && (
              <label className="u-field">
                <FormattedMessage id="u.sign.yourEmail" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
            )}

            <label className="u-field">
              <FormattedMessage id="u.sign.cpfOptional" />
              <input
                type="text"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                inputMode="numeric"
                placeholder="000.000.000-00"
              />
            </label>

            <button
              type="button"
              className={`u-location u-location-${geoState}`}
              onClick={requestLocation}
            >
              <IconPin />
              {geoState === 'ok' && geo ? (
                <span className="u-location-text">
                  <span className="u-location-label">
                    <FormattedMessage id="u.capture.locationCaptured" />
                  </span>
                  <span className="u-location-coords">
                    {geo.lat?.toFixed(5)}, {geo.lng?.toFixed(5)}
                  </span>
                </span>
              ) : geoState === 'locating' ? (
                <FormattedMessage id="u.capture.locating" />
              ) : geoState === 'denied' ? (
                <FormattedMessage id="u.sign.locationDenied" />
              ) : (
                <FormattedMessage id="u.capture.location" />
              )}
            </button>

            <p className="u-sign-consent">
              <FormattedMessage id="u.sign.consent" />
            </p>

            {error && <div className="u-error">{error}</div>}

            <button className="u-btn-primary" onClick={submit} disabled={busy}>
              <FormattedMessage id={busy ? 'u.sign.signing' : 'u.sign.button'} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
