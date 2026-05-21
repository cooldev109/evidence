import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { api, type AuditRow } from '../api.ts';

export function Audit() {
  const intl = useIntl();
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    api.audit().then((r) => setRows(r.events));
  }, []);

  return (
    <div>
      <h1>{intl.formatMessage({ id: 'audit.title' })}</h1>
      <table className="grid">
        <thead>
          <tr>
            <th>{intl.formatMessage({ id: 'audit.when' })}</th>
            <th>{intl.formatMessage({ id: 'audit.actor' })}</th>
            <th>{intl.formatMessage({ id: 'audit.action' })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.createdAt}</td>
              <td>{r.actorEmail}</td>
              <td>
                <code>{r.action}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
