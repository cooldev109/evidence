import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import { userApi, mediaUrl, getUserToken, type CaptureDetail, type OwnerSigner } from './userApi.ts';
import { IconShield, IconPin, IconHash } from '../icons.tsx';
import { AuthedImage, AuthedVideo, AuthedAudio, AuthedDownloadLink } from '../lib/AuthedMedia.tsx';

function SignerRow({ signer }: { signer: OwnerSigner }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(signer.signUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="u-signer-row">
      <div className="u-signer-info">
        <strong>{signer.name || signer.email || '—'}</strong>
        {signer.email && signer.name && <span className="u-signer-email">{signer.email}</span>}
      </div>
      {signer.signed ? (
        <span className="badge ok">
          <FormattedMessage id="u.detail.signed" />
        </span>
      ) : (
        <button className="link" onClick={copy}>
          <FormattedMessage id={copied ? 'u.detail.copied' : 'u.detail.copyLink'} />
        </button>
      )}
    </div>
  );
}

export function ProvaDetail() {
  const intl = useIntl();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<CaptureDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    userApi
      .capture(id)
      .then(setData)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div className="u-page">
        <Link to="/" className="u-back">
          ← <FormattedMessage id="u.detail.back" />
        </Link>
        <div className="u-empty">
          <p>404</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="u-page"><div className="u-skeleton-card lg" /></div>;

  const { capture, event } = data;
  const ts = event?.timestamps?.[0];

  return (
    <div className="u-page">
      <Link to="/" className="u-back">
        ← <FormattedMessage id="u.detail.back" />
      </Link>

      <div className="u-detail-media">
        {capture.kind === 'photo' ? (
          <AuthedImage src={mediaUrl(capture.id)} alt={capture.title} getToken={getUserToken} />
        ) : capture.kind === 'video' ? (
          <AuthedVideo src={mediaUrl(capture.id)} getToken={getUserToken} />
        ) : capture.kind === 'audio' ? (
          <AuthedAudio src={mediaUrl(capture.id)} getToken={getUserToken} />
        ) : (
          <div className="u-capture-placeholder">{capture.kind.toUpperCase()}</div>
        )}
      </div>

      <h1 className="u-detail-title">
        {capture.title || intl.formatMessage({ id: `u.kind.${capture.kind}` })}
      </h1>

      <div className="u-sealed-banner">
        <IconShield />
        <FormattedMessage id="u.detail.sealed" />
      </div>

      {capture.kind === 'ata' && capture.transcript && (
        <div className="u-transcript">
          <div className="u-transcript-head">
            <FormattedMessage id="u.detail.transcript" />
          </div>
          <p>{capture.transcript}</p>
        </div>
      )}

      {capture.kind === 'ata' && data.signers.length > 0 && (
        <div className="u-signers">
          <div className="u-transcript-head">
            <FormattedMessage id="u.detail.signatures" />
          </div>
          {data.signers.map((s) => (
            <SignerRow key={s.id} signer={s} />
          ))}
        </div>
      )}

      <dl className="u-detail-list">
        <div>
          <dt>
            <FormattedMessage id="u.detail.capturedAt" />
          </dt>
          <dd>{new Date(capture.capturedAt).toLocaleString(intl.locale)}</dd>
        </div>
        {capture.geo && capture.geo.lat != null && (
          <div>
            <dt>
              <IconPin /> <FormattedMessage id="u.detail.location" />
            </dt>
            <dd>
              <a
                href={`https://www.openstreetmap.org/?mlat=${capture.geo.lat}&mlon=${capture.geo.lng}#map=17/${capture.geo.lat}/${capture.geo.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                {capture.geo.lat.toFixed(5)}, {capture.geo.lng?.toFixed(5)}
              </a>
            </dd>
          </div>
        )}
        {ts && (
          <div>
            <dt>
              <FormattedMessage id="u.detail.timestamp" />
            </dt>
            <dd>
              {new Date(ts.issuedAt).toLocaleString(intl.locale)}
              <span className="u-ts-provider"> · {ts.provider}</span>
            </dd>
          </div>
        )}
        <div>
          <dt>
            <IconHash /> <FormattedMessage id="u.detail.hash" />
          </dt>
          <dd className="u-mono">{capture.mediaSha256}</dd>
        </div>
      </dl>

      <AuthedDownloadLink
        src={mediaUrl(capture.id)}
        filename={`${capture.id}.${capture.contentType.split('/')[1] ?? 'bin'}`}
        getToken={getUserToken}
        className="u-btn-ghost u-download"
      >
        <FormattedMessage id="u.detail.download" />
      </AuthedDownloadLink>
    </div>
  );
}
