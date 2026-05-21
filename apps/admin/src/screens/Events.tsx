import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import { api, type EventRow } from '../api.ts';

export function Events() {
  const intl = useIntl();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cursorStack, setCursorStack] = useState<number[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);

  function load(cursor?: number) {
    api.events(cursor).then((r) => {
      setEvents(r.events);
      setNextCursor(r.nextCursor);
    });
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <h1>
        <FormattedMessage id="events.title" />
      </h1>
      {events.length === 0 ? (
        <p>{intl.formatMessage({ id: 'events.empty' })}</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>{intl.formatMessage({ id: 'events.seq' })}</th>
              <th>{intl.formatMessage({ id: 'events.source' })}</th>
              <th>{intl.formatMessage({ id: 'events.created' })}</th>
              <th>{intl.formatMessage({ id: 'events.chainHash' })}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/events/${e.id}`}>{e.seq}</Link>
                </td>
                <td>{e.source}</td>
                <td>{e.createdAt}</td>
                <td className="mono">{e.chainHash.slice(0, 16)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pager">
        <button
          disabled={cursorStack.length === 0}
          onClick={() => {
            const stack = [...cursorStack];
            stack.pop();
            const prev = stack[stack.length - 1];
            setCursorStack(stack);
            load(prev);
          }}
        >
          {intl.formatMessage({ id: 'events.prev' })}
        </button>
        <button
          disabled={nextCursor === null}
          onClick={() => {
            if (nextCursor === null) return;
            setCursorStack([...cursorStack, nextCursor]);
            load(nextCursor);
          }}
        >
          {intl.formatMessage({ id: 'events.next' })}
        </button>
      </div>
    </div>
  );
}
