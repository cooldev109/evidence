import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { api, ApiError } from '../api.ts';
import { LOCALES } from '../i18n.ts';

/** Cosmetic CNPJ formatter: 14 digits → "12.345.678/0001-99". */
function formatCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  const p = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 12), d.slice(12, 14)];
  let out = p[0];
  if (p[1]) out += '.' + p[1];
  if (p[2]) out += '.' + p[2];
  if (p[3]) out += '/' + p[3];
  if (p[4]) out += '-' + p[4];
  return out;
}

export function Settings() {
  const intl = useIntl();
  const [locale, setLocale] = useState('pt-BR');
  const [cnpj, setCnpj] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then((r) => {
      setLocale(r.tenant.locale);
      setCnpj(r.tenant.cnpj ?? '');
    });
  }, []);

  async function save() {
    setError(null);
    try {
      await api.saveSettings({ locale, cnpj: cnpj.trim() === '' ? null : cnpj.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(intl.formatMessage({ id: 'settings.cnpjInvalid' }));
      } else {
        setError(intl.formatMessage({ id: 'settings.saveFailed' }));
      }
    }
  }

  const cnpjDigits = cnpj.replace(/\D/g, '').length;

  return (
    <div>
      <h1>{intl.formatMessage({ id: 'settings.title' })}</h1>
      <div className="card form">
        <label>
          {intl.formatMessage({ id: 'settings.locale' })}
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          {intl.formatMessage({ id: 'settings.cnpj' })}
          <input
            type="text"
            value={cnpj}
            onChange={(e) => setCnpj(formatCnpj(e.target.value))}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            maxLength={18}
            style={{ minWidth: 220 }}
          />
          <small className="muted" style={{ marginTop: 4 }}>
            {cnpjDigits === 0
              ? intl.formatMessage({ id: 'settings.cnpjHint' })
              : cnpjDigits === 14
                ? intl.formatMessage({ id: 'settings.cnpjOk' })
                : intl.formatMessage(
                    { id: 'settings.cnpjLength' },
                    { count: cnpjDigits },
                  )}
          </small>
        </label>
        <button onClick={save}>{intl.formatMessage({ id: 'settings.save' })}</button>
        {saved && <span className="saved">{intl.formatMessage({ id: 'settings.saved' })}</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
