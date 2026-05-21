import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import { api, type EventRow } from '../api.ts';

export function EventDetail() {
  const { id } = useParams();
  const intl = useIntl();
  const [event, setEvent] = useState<EventRow | null>(null);
  useEffect(() => {
    if (id) api.event(id).then((r) => setEvent(r.event)).catch(() => setEvent(null));
  }, [id]);

  if (!event) return <p>…</p>;

  return (
    <div>
      <Link to="/events">← {intl.formatMessage({ id: 'event.back' })}</Link>
      <h1>
        <FormattedMessage id="event.title" /> #{event.seq}
      </h1>
      <table className="kv">
        <tbody>
          <tr>
            <th>{intl.formatMessage({ id: 'events.source' })}</th>
            <td>{event.source}</td>
          </tr>
          <tr>
            <th>{intl.formatMessage({ id: 'events.created' })}</th>
            <td>{event.createdAt}</td>
          </tr>
          <tr>
            <th>{intl.formatMessage({ id: 'event.payloadHash' })}</th>
            <td className="mono">{event.payloadHash}</td>
          </tr>
          <tr>
            <th>{intl.formatMessage({ id: 'event.prevHash' })}</th>
            <td className="mono">{event.prevHash}</td>
          </tr>
          <tr>
            <th>{intl.formatMessage({ id: 'events.chainHash' })}</th>
            <td className="mono">{event.chainHash}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
