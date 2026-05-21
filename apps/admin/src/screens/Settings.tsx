import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { api } from '../api.ts';
import { LOCALES } from '../i18n.ts';

export function Settings() {
  const intl = useIntl();
  const [locale, setLocale] = useState('pt-BR');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings().then((r) => setLocale(r.tenant.locale));
  }, []);

  async function save() {
    await api.saveSettings(locale);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

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
        <button onClick={save}>{intl.formatMessage({ id: 'settings.save' })}</button>
        {saved && <span className="saved">{intl.formatMessage({ id: 'settings.saved' })}</span>}
      </div>
    </div>
  );
}
