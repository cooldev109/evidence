import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import { uploadCapture, uploadAta, type CaptureGeo, type AtaParticipant } from './userApi.ts';
import { IconPin } from '../icons.tsx';

type Kind = 'photo' | 'video' | 'audio' | 'ata';

const ACCEPT: Record<Kind, string> = {
  photo: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  ata: 'audio/*',
};
const DEFAULT_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/webm': 'weba',
  'audio/mpeg': 'mp3',
};

function extFor(type: string): string {
  return DEFAULT_EXT[type] ?? 'bin';
}

export function Capture() {
  const intl = useIntl();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<Kind>('photo');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [geo, setGeo] = useState<CaptureGeo | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'ok' | 'denied'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<AtaParticipant[]>([{ name: '', email: '' }]);

  const isAudioKind = kind === 'audio' || kind === 'ata';

  // Audio recording state
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Request geolocation up front so it's embedded in the evidence.
  useEffect(() => {
    requestLocation();
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      setGeoState('denied');
      return;
    }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGeoState('ok');
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  function chooseFile(f: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setFile(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      // Fall back to a file picker if mic access is unavailable.
      fileInput.current?.click();
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
  }

  async function submit() {
    if (!file) {
      setError(intl.formatMessage({ id: 'u.capture.needFile' }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const type = file.type || ACCEPT[kind];
      const capturedAt = new Date().toISOString();
      if (kind === 'ata') {
        await uploadAta(file, `ata.${extFor(type)}`, {
          title,
          capturedAt,
          geo,
          language: intl.locale.slice(0, 2),
          participants: participants.filter((p) => p.name || p.email),
        });
      } else {
        await uploadCapture(file, `${kind}.${extFor(type)}`, { kind, title, capturedAt, geo });
      }
      navigate('/');
    } catch {
      setError(intl.formatMessage({ id: 'u.capture.error' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="u-page">
      <div className="u-page-head">
        <h1>
          <FormattedMessage id="u.capture.title" />
        </h1>
      </div>

      {/* Type selector */}
      <div className="u-segment">
        {(['photo', 'video', 'audio', 'ata'] as Kind[]).map((k) => (
          <button
            key={k}
            className={kind === k ? 'active' : ''}
            onClick={() => {
              setKind(k);
              reset();
            }}
          >
            <FormattedMessage id={`u.kind.${k}`} />
          </button>
        ))}
      </div>

      {kind === 'ata' && (
        <p className="u-ata-hint">
          <FormattedMessage id="u.capture.ataHint" />
        </p>
      )}

      {/* Capture surface */}
      <div className="u-capture-surface">
        {previewUrl ? (
          kind === 'photo' ? (
            <img src={previewUrl} alt="preview" />
          ) : kind === 'video' ? (
            <video src={previewUrl} controls />
          ) : (
            <audio src={previewUrl} controls />
          )
        ) : (
          <div className="u-capture-placeholder">
            <FormattedMessage id={`u.kind.${kind}`} />
          </div>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT[kind]}
        capture={isAudioKind ? undefined : 'environment'}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) chooseFile(f);
        }}
      />

      <div className="u-capture-actions">
        {file ? (
          <button className="u-btn-ghost" onClick={reset}>
            <FormattedMessage id="u.capture.retake" />
          </button>
        ) : isAudioKind ? (
          <button className={recording ? 'u-btn-rec recording' : 'u-btn-rec'} onClick={toggleRecording}>
            <FormattedMessage id={recording ? 'u.capture.stop' : 'u.capture.recordAudio'} />
          </button>
        ) : (
          <button className="u-btn-primary" onClick={() => fileInput.current?.click()}>
            <FormattedMessage id={kind === 'photo' ? 'u.capture.takePhoto' : 'u.capture.recordVideo'} />
          </button>
        )}
      </div>

      {/* ATA participants */}
      {kind === 'ata' && (
        <div className="u-field">
          <FormattedMessage id="u.capture.participants" />
          <div className="u-participants">
            {participants.map((p, i) => (
              <div className="u-participant-row" key={i}>
                <input
                  type="text"
                  placeholder={intl.formatMessage({ id: 'u.capture.participantName' })}
                  value={p.name ?? ''}
                  onChange={(e) =>
                    setParticipants((ps) =>
                      ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <input
                  type="email"
                  placeholder={intl.formatMessage({ id: 'u.capture.participantEmail' })}
                  value={p.email ?? ''}
                  onChange={(e) =>
                    setParticipants((ps) =>
                      ps.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="link"
              onClick={() => setParticipants((ps) => [...ps, { name: '', email: '' }])}
            >
              <FormattedMessage id="u.capture.addParticipant" />
            </button>
          </div>
        </div>
      )}

      {/* Title */}
      <label className="u-field">
        <FormattedMessage id="u.capture.titleField" />
        <input
          type="text"
          value={title}
          maxLength={256}
          placeholder={intl.formatMessage({ id: 'u.capture.titlePlaceholder' })}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      {/* Location */}
      <button className={`u-location u-location-${geoState}`} onClick={requestLocation} type="button">
        <IconPin />
        {geoState === 'ok' && geo ? (
          <span>
            {geo.lat?.toFixed(5)}, {geo.lng?.toFixed(5)}
            {geo.accuracy ? ` (±${Math.round(geo.accuracy)}m)` : ''}
          </span>
        ) : geoState === 'locating' ? (
          <FormattedMessage id="u.capture.locating" />
        ) : geoState === 'denied' ? (
          <FormattedMessage id="u.capture.locationOff" />
        ) : (
          <FormattedMessage id="u.capture.location" />
        )}
      </button>

      {error && <div className="u-error">{error}</div>}

      <button className="u-btn-primary u-submit" onClick={submit} disabled={busy || !file}>
        {busy ? (
          <FormattedMessage id={kind === 'ata' ? 'u.capture.transcribing' : 'u.capture.uploading'} />
        ) : (
          <FormattedMessage id="u.capture.submit" />
        )}
      </button>
    </div>
  );
}
