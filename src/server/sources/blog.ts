import { fetchFeed, validators } from '../fetchFeed';
import { parseFeed } from '../parseFeed';
import type { SourcePayload, SourceSnapshot } from '../../utils/content';
import { subDays } from 'date-fns';

export async function load(previous?: SourceSnapshot): Promise<SourcePayload> {
  const response = await fetchFeed('https://blog.sentry.io/feed.xml', previous);
  if (response.status === 304 && previous) return previous;
  if (!response.ok) throw new Error(`Blog feed unavailable (${response.status})`);
  const cutoff = subDays(new Date(), 90).getTime();
  const items = parseFeed(await response.text(), 'blog').filter(post => Date.parse(post.publishedAt) >= cutoff);
  return { items, ...validators(response) };
}
