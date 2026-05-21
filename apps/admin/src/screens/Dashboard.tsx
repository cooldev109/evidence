import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { api, type Overview } from '../api.ts';

export function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    api.overview().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p>…</p>;

  return (
    <div>
      <h1>
        <FormattedMessage id="dash.title" /> — {data.tenant?.name}
      </h1>
      <div className="cards">
        <div className="card stat">
          <div className="stat-value">{data.eventCount}</div>
          <div className="stat-label">
            <FormattedMessage id="dash.events" />
          </div>
        </div>
        <div className="card stat">
          <div className="stat-value">{data.lastSeq}</div>
          <div className="stat-label">
            <FormattedMessage id="dash.lastSeq" />
          </div>
        </div>
        <div className="card stat">
          <div className="stat-value">{data.apiKeyCount}</div>
          <div className="stat-label">
            <FormattedMessage id="dash.keys" />
          </div>
        </div>
        <div className="card stat">
          <div className={`badge ${data.chain.ok ? 'ok' : 'bad'}`}>
            <FormattedMessage id={data.chain.ok ? 'dash.chainOk' : 'dash.chainBroken'} />
          </div>
          <div className="stat-label">
            <FormattedMessage id="dash.chain" />
          </div>
        </div>
      </div>
    </div>
  );
}
