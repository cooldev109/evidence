import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { api, type ApiKey } from '../api.ts';

export function ApiKeys() {
  const intl = useIntl();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [label, setLabel] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);

  function load() {
    api.apiKeys().then((r) => setKeys(r.keys));
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!label.trim()) return;
    const res = await api.createKey(label.trim());
    setNewKey(res.key);
    setLabel('');
    load();
  }
  async function revoke(id: string) {
    await api.revokeKey(id);
    load();
  }

  return (
    <div>
      <h1>{intl.formatMessage({ id: 'keys.title' })}</h1>
      <div className="card form">
        <input
          placeholder={intl.formatMessage({ id: 'keys.newLabel' })}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button onClick={create}>{intl.formatMessage({ id: 'keys.create' })}</button>
      </div>
      {newKey && (
        <div className="card key-reveal">
          <p>{intl.formatMessage({ id: 'keys.copy' })}</p>
          <code>{newKey}</code>
        </div>
      )}
      <table className="grid">
        <thead>
          <tr>
            <th>{intl.formatMessage({ id: 'keys.label' })}</th>
            <th>{intl.formatMessage({ id: 'keys.created' })}</th>
            <th>{intl.formatMessage({ id: 'keys.status' })}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.label}</td>
              <td>{k.createdAt}</td>
              <td>
                <span className={`badge ${k.revokedAt ? 'bad' : 'ok'}`}>
                  {intl.formatMessage({ id: k.revokedAt ? 'keys.revoked' : 'keys.active' })}
                </span>
              </td>
              <td>
                {!k.revokedAt && (
                  <button className="link danger" onClick={() => revoke(k.id)}>
                    {intl.formatMessage({ id: 'keys.revoke' })}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
