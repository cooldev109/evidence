import { useState } from 'react';
import { useIntl } from 'react-intl';
import { downloadReport } from '../api.ts';
import { LOCALES } from '../i18n.ts';

export function Reports() {
  const intl = useIntl();
  const [locale, setLocale] = useState('pt-BR');
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      await downloadReport(locale);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>{intl.formatMessage({ id: 'reports.title' })}</h1>
      <div className="card form">
        <label>
          {intl.formatMessage({ id: 'reports.locale' })}
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button onClick={generate} disabled={busy}>
          {intl.formatMessage({ id: busy ? 'reports.generating' : 'reports.generate' })}
        </button>
      </div>
    </div>
  );
}
