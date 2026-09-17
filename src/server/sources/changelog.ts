import { fetchFeed, validators } from '../fetchFeed';
import { parseFeed } from '../parseFeed';
import type { SourcePayload, SourceSnapshot } from '../../utils/content';

export async function load(previous?: SourceSnapshot): Promise<SourcePayload> {
  const response = await fetchFeed('https://sentry.io/changelog/feed.xml', previous);
  if (response.status === 304 && previous) return previous;
  if (!response.ok) throw new Error(`Changelog feed unavailable (${response.status})`);
  const cutoff = Date.now() - 90 * 86400000;
  const items = parseFeed(await response.text(), 'changelog').filter(post => Date.parse(post.publishedAt) >= cutoff);
  return { items, ...validators(response) };
}
