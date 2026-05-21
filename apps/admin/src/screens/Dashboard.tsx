import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { api, type Overview } from '../api.ts';
import { IconEvents, IconHash, IconKeys, IconShield } from '../icons.tsx';

export function Dashboard() {
  const intl = useIntl();
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    api.overview().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="muted">…</p>;
  const chainOk = data.chain.ok;

  return (
    <div>
      <h1>
        <FormattedMessage id="dash.title" />
      </h1>
      <p className="subtitle">{data.tenant?.name}</p>

      <div className={`status-banner ${chainOk ? 'ok' : 'bad'}`}>
        <div className="dot">
          <IconShield className="" />
        </div>
        <div>
          <div className="st-title">
            <FormattedMessage id={chainOk ? 'dash.chainOk' : 'dash.chainBroken'} />
          </div>
          <div className="st-sub">
            {chainOk
              ? `${data.chain.verified ?? data.eventCount} ${intl.formatMessage({ id: 'dash.events' }).toLowerCase()}`
              : `${data.chain.reason ?? ''} @ seq ${data.chain.atSeq ?? '?'}`}
          </div>
        </div>
      </div>

      <div className="cards">
        <div className="card stat">
          <div className="ico"><IconEvents className="" /></div>
          <div>
            <div className="stat-value">{data.eventCount}</div>
            <div className="stat-label"><FormattedMessage id="dash.events" /></div>
          </div>
        </div>
        <div className="card stat">
          <div className="ico"><IconHash className="" /></div>
          <div>
            <div className="stat-value">{data.lastSeq}</div>
            <div className="stat-label"><FormattedMessage id="dash.lastSeq" /></div>
          </div>
        </div>
        <div className="card stat">
          <div className="ico"><IconKeys className="" /></div>
          <div>
            <div className="stat-value">{data.apiKeyCount}</div>
            <div className="stat-label"><FormattedMessage id="dash.keys" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
