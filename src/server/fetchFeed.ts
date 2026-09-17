import type { SourceSnapshot } from '../utils/content';

export function fetchFeed(url: string, previous?: SourceSnapshot) {
  const headers = new Headers();
  if (previous?.etag) headers.set('If-None-Match', previous.etag);
  if (previous?.lastModified) headers.set('If-Modified-Since', previous.lastModified);
  return fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
}
export function validators(response: Response) {
  return {
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
  };
}
