import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import { userApi, type Capture } from './userApi.ts';
import { IconShield, IconPin } from '../icons.tsx';

const KIND_EMOJI: Record<Capture['kind'], string> = {
  photo: '📷',
  video: '🎬',
  audio: '🎙️',
  ata: '📝',
};

export function MinhasProvas() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [captures, setCaptures] = useState<Capture[] | null>(null);

  useEffect(() => {
    userApi
      .captures()
      .then((r) => setCaptures(r.captures))
      .catch(() => setCaptures([]));
  }, []);

  return (
    <div className="u-page">
      <div className="u-page-head">
        <h1>
          <FormattedMessage id="u.provas.title" />
        </h1>
        <button className="u-btn-primary sm" onClick={() => navigate('/capturar')}>
          + <FormattedMessage id="u.provas.new" />
        </button>
      </div>

      {captures === null ? (
        <div className="u-skeleton-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="u-skeleton-card" />
          ))}
        </div>
      ) : captures.length === 0 ? (
        <div className="u-empty">
          <IconShield className="u-empty-icon" />
          <p>
            <FormattedMessage id="u.provas.empty" />
          </p>
          <small>
            <FormattedMessage id="u.provas.emptyHint" />
          </small>
        </div>
      ) : (
        <div className="u-prova-grid">
          {captures.map((c) => (
            <Link key={c.id} to={`/prova/${c.id}`} className="u-prova-card">
              <div className="u-prova-thumb">
                {c.kind === 'photo' ? (
                  <img src={`/app/v1/captures/${c.id}/media`} alt={c.title} loading="lazy" />
                ) : (
                  <span className="u-prova-emoji">{KIND_EMOJI[c.kind]}</span>
                )}
                <span className="u-prova-badge">{intl.formatMessage({ id: `u.kind.${c.kind}` })}</span>
              </div>
              <div className="u-prova-meta">
                <strong>{c.title || intl.formatMessage({ id: `u.kind.${c.kind}` })}</strong>
                <span className="u-prova-date">
                  {new Date(c.capturedAt).toLocaleString(intl.locale)}
                </span>
                {c.geo && (c.geo.lat != null) && (
                  <span className="u-prova-geo">
                    <IconPin /> {c.geo.lat.toFixed(4)}, {c.geo.lng?.toFixed(4)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
