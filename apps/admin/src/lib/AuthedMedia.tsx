import { useEffect, useState, type ReactNode } from 'react';

/**
 * `<img>`/`<video>`/`<audio>` and download anchors don't send the Authorization
 * header. The protected `/app/v1/captures/:id/media` (and admin equivalent)
 * endpoints reject those requests with 401. This module fetches the media with
 * the right Bearer token, converts the response to an `URL.createObjectURL`
 * blob URL, and exposes small wrapper components that render normally.
 */

export function useAuthedBlob(
  url: string | null,
  getToken: () => string | null,
): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    let created: string | null = null;
    fetch(url, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (cancelled) return;
        created = URL.createObjectURL(b);
        setBlobUrl(created);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, getToken]);
  return blobUrl;
}

interface BaseProps {
  src: string;
  getToken: () => string | null;
  className?: string;
}

export function AuthedImage({ src, alt, getToken, className }: BaseProps & { alt?: string }) {
  const blob = useAuthedBlob(src, getToken);
  if (!blob) return <div className={(className ?? '') + ' u-media-loading'} aria-busy="true" />;
  return <img className={className} src={blob} alt={alt ?? ''} loading="lazy" />;
}

export function AuthedVideo({ src, getToken, className }: BaseProps) {
  const blob = useAuthedBlob(src, getToken);
  if (!blob) return <div className={(className ?? '') + ' u-media-loading'} aria-busy="true" />;
  return <video className={className} src={blob} controls />;
}

export function AuthedAudio({ src, getToken, className }: BaseProps) {
  const blob = useAuthedBlob(src, getToken);
  if (!blob) return <div className={(className ?? '') + ' u-media-loading'} aria-busy="true" />;
  return <audio className={className} src={blob} controls />;
}

export function AuthedDownloadLink({
  src,
  filename,
  getToken,
  className,
  children,
}: BaseProps & { filename: string; children: ReactNode }) {
  const blob = useAuthedBlob(src, getToken);
  return (
    <a
      className={className}
      href={blob ?? '#'}
      download={filename}
      onClick={(e) => {
        if (!blob) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}
