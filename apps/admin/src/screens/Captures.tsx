import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { api, getToken, type CaptureRow, type AppUserRow, type AdminSigner } from '../api.ts';
import { AuthedImage, AuthedVideo, AuthedAudio, AuthedDownloadLink } from '../lib/AuthedMedia.tsx';

const KIND_EMOJI: Record<CaptureRow['kind'], string> = {
  photo: '📷',
  video: '🎬',
  audio: '🎙️',
  ata: '📝',
};

export function Captures() {
  const intl = useIntl();
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [users, setUsers] = useState<Record<string, AppUserRow>>({});
  const [selected, setSelected] = useState<CaptureRow | null>(null);
  const [signers, setSigners] = useState<AdminSigner[]>([]);

  useEffect(() => {
    api.captures().then((r) => setCaptures(r.captures)).catch(() => {});
    api
      .users()
      .then((r) => setUsers(Object.fromEntries(r.users.map((u) => [u.id, u]))))
      .catch(() => {});
  }, []);

  const open = (c: CaptureRow) => {
    setSelected(c);
    setSigners([]);
    if (c.kind === 'ata') {
      api.capture(c.id).then((d) => setSigners(d.signers)).catch(() => {});
    }
  };

  return (
    <div>
      <h1>
        <FormattedMessage id="caps.title" />
      </h1>
      <p className="subtitle">
        <FormattedMessage id="caps.subtitle" />
      </p>

      {captures.length === 0 ? (
        <div className="empty">
          <FormattedMessage id="caps.empty" />
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>{intl.formatMessage({ id: 'caps.kind' })}</th>
              <th>{intl.formatMessage({ id: 'caps.titleCol' })}</th>
              <th>{intl.formatMessage({ id: 'caps.user' })}</th>
              <th>{intl.formatMessage({ id: 'caps.when' })}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {captures.map((c) => (
              <tr key={c.id}>
                <td>
                  {KIND_EMOJI[c.kind]} {intl.formatMessage({ id: `u.kind.${c.kind}` })}
                </td>
                <td>{c.title || '—'}</td>
                <td>{users[c.appUserId]?.email ?? c.appUserId.slice(0, 8)}</td>
                <td>{new Date(c.capturedAt).toLocaleString(intl.locale)}</td>
                <td>
                  <button className="link" onClick={() => open(c)}>
                    <FormattedMessage id="caps.view" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div className="cap-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="cap-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cap-modal-close" onClick={() => setSelected(null)}>
              ✕
            </button>
            <div className="cap-modal-media">
              {selected.kind === 'photo' ? (
                <AuthedImage src={`/admin/v1/captures/${selected.id}/media`} alt={selected.title} getToken={getToken} />
              ) : selected.kind === 'video' ? (
                <AuthedVideo src={`/admin/v1/captures/${selected.id}/media`} getToken={getToken} />
              ) : selected.kind === 'audio' ? (
                <AuthedAudio src={`/admin/v1/captures/${selected.id}/media`} getToken={getToken} />
              ) : (
                <div className="u-capture-placeholder">{selected.kind.toUpperCase()}</div>
              )}
            </div>
            <h3>{selected.title || intl.formatMessage({ id: `u.kind.${selected.kind}` })}</h3>
            {selected.kind === 'ata' && selected.transcript && (
              <div className="u-transcript">
                <div className="u-transcript-head">
                  <FormattedMessage id="u.detail.transcript" />
                </div>
                <p>{selected.transcript}</p>
              </div>
            )}
            {selected.kind === 'ata' && signers.length > 0 && (
              <div className="u-signers">
                <div className="u-transcript-head">
                  <FormattedMessage id="u.detail.signatures" />
                </div>
                {signers.map((s, i) => (
                  <div className="u-signer-row" key={i}>
                    <div className="u-signer-info">
                      <strong>{s.name || s.email || '—'}</strong>
                      {s.email && s.name && <span className="u-signer-email">{s.email}</span>}
                    </div>
                    <span className={s.signed ? 'badge ok' : 'badge bad'}>
                      <FormattedMessage id={s.signed ? 'u.detail.signed' : 'u.detail.sigPending'} />
                    </span>
                  </div>
                ))}
              </div>
            )}
            <table className="kv">
              <tbody>
                <tr>
                  <th>{intl.formatMessage({ id: 'caps.user' })}</th>
                  <td>{users[selected.appUserId]?.email ?? selected.appUserId}</td>
                </tr>
                <tr>
                  <th>{intl.formatMessage({ id: 'caps.when' })}</th>
                  <td>{new Date(selected.capturedAt).toLocaleString(intl.locale)}</td>
                </tr>
                {selected.geo && selected.geo.lat != null && (
                  <tr>
                    <th>{intl.formatMessage({ id: 'u.detail.location' })}</th>
                    <td>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${selected.geo.lat}&mlon=${selected.geo.lng}#map=17/${selected.geo.lat}/${selected.geo.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {selected.geo.lat.toFixed(5)}, {selected.geo.lng?.toFixed(5)}
                      </a>
                    </td>
                  </tr>
                )}
                <tr>
                  <th>{intl.formatMessage({ id: 'u.detail.hash' })}</th>
                  <td className="mono">{selected.mediaSha256}</td>
                </tr>
              </tbody>
            </table>
            <AuthedDownloadLink
              className="link"
              src={`/admin/v1/captures/${selected.id}/media`}
              filename={`${selected.id}.${selected.contentType.split('/')[1] ?? 'bin'}`}
              getToken={getToken}
            >
              <FormattedMessage id="u.detail.download" />
            </AuthedDownloadLink>
          </div>
        </div>
      )}
    </div>
  );
}
