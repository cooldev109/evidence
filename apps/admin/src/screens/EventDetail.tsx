import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import { api, type EventRow, type EventTimestamp } from '../api.ts';

export function EventDetail() {
  const { id } = useParams();
  const intl = useIntl();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [timestamps, setTimestamps] = useState<EventTimestamp[]>([]);

  useEffect(() => {
    if (id)
      api
        .event(id)
        .then((r) => {
          setEvent(r.event);
          setPayload(r.payload);
          setTimestamps(r.timestamps ?? []);
        })
        .catch(() => setEvent(null));
  }, [id]);

  if (!event) return <p className="muted">…</p>;

  return (
    <div>
      <Link to="/events">← {intl.formatMessage({ id: 'event.back' })}</Link>
      <h1>
        <FormattedMessage id="event.title" /> #{event.seq}
      </h1>
      <p className="subtitle">{event.source} · {event.createdAt}</p>

      {/* The evidence itself: the captured content */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 12px' }}>{intl.formatMessage({ id: 'event.content' })}</h3>
        <pre className="payload">{JSON.stringify(payload, null, 2)}</pre>
      </div>

      {/* Trusted timestamp */}
      {timestamps.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 12px' }}>{intl.formatMessage({ id: 'event.timestamp' })}</h3>
          {timestamps.map((t, i) => (
            <table className="kv" key={i}>
              <tbody>
                <tr><th>{intl.formatMessage({ id: 'event.provider' })}</th><td>{t.provider} ({t.jurisdiction})</td></tr>
                <tr><th>{intl.formatMessage({ id: 'event.issuedAt' })}</th><td>{t.issuedAt}</td></tr>
              </tbody>
            </table>
          ))}
        </div>
      )}

      {/* Integrity proof */}
      <div className="card">
        <h3 style={{ margin: '0 0 12px' }}>{intl.formatMessage({ id: 'event.integrity' })}</h3>
        <table className="kv">
          <tbody>
            <tr><th>{intl.formatMessage({ id: 'event.payloadHash' })}</th><td className="mono">{event.payloadHash}</td></tr>
            <tr><th>{intl.formatMessage({ id: 'event.prevHash' })}</th><td className="mono">{event.prevHash}</td></tr>
            <tr><th>{intl.formatMessage({ id: 'events.chainHash' })}</th><td className="mono">{event.chainHash}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
