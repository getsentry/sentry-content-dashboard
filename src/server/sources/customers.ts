import * as Sentry from '@sentry/nextjs';
import { normalizeContent } from '../../utils/content';
import {
  getCustomerStoryState, saveCustomerStoryState,
  type CustomerStory, type CustomerStoryState,
} from '../../utils/customerStoryStorage';

const SENTRY_BASE_URL = process.env.SENTRY_BASE_URL || 'https://sentry.io';
const SITEMAP_URL = `${SENTRY_BASE_URL}/sitemap/sitemap-0.xml`;

// Customer stories carry no publish date: the sitemap has no <lastmod>, no
// Last-Modified header is sent, and the pages have no article:published_time.
// A story is therefore dated from when this source first sees it.
//
// The sitemap offers no ETag either, so every poll is a full download. Stories
// arrive a few times a month, so polling hourly costs nothing in freshness.
const POLL_INTERVAL_MS = 3600000;
const MAX_STORIES_PER_POLL = 10;

export function isStoryUrl(loc: string) {
  let parsed;
  try { parsed = new URL(loc); } catch { return false; }
  if (parsed.origin !== new URL(SENTRY_BASE_URL).origin) return false;
  return /^\/customers\/[^/]+\/?$/.test(parsed.pathname);
}

export async function load() {
  const state = await getCustomerStoryState();
  const discovered = Date.now() - state.lastPolledAt < POLL_INTERVAL_MS ? state : await poll(state);
  const items = normalizeContent(discovered.stories, 'customers')
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { items };
}

async function poll(state: CustomerStoryState): Promise<CustomerStoryState> {
  let urls: string[];
  try {
    urls = await fetchSitemapUrls();
  } catch (error) {
    // A sitemap outage must not clear the baseline or re-display the catalogue.
    Sentry.captureException(error);
    Sentry.logger.warn('Customer story sitemap unavailable; serving stored stories');
    return state;
  }
  if (!urls.length) {
    Sentry.logger.warn('Customer story sitemap held no stories; baseline unchanged');
    return state;
  }

  const known = new Set(state.knownUrls);
  const unseen = urls.filter(url => !known.has(url));
  // With no baseline at all — no committed floor and no stored state — the live
  // catalogue becomes the baseline and none of it is displayed. A committed
  // floor is itself a baseline, so it is diffed against rather than replaced.
  const seeding = !known.size;
  const polledAt = Date.now();

  if (seeding) {
    await saveCustomerStoryState({ knownUrls: urls, stories: [], lastPolledAt: polledAt });
    Sentry.logger.info('Customer story baseline seeded', { storyCount: urls.length });
    return { knownUrls: [...known, ...urls], stories: state.stories, lastPolledAt: polledAt };
  }

  const stories: CustomerStory[] = [];
  for (const url of unseen.slice(0, MAX_STORIES_PER_POLL)) {
    const story = await fetchStory(url, new Date(polledAt).toISOString());
    // A page that failed stays out of knownUrls so the next poll retries it.
    if (story) stories.push(story);
  }
  if (stories.length) Sentry.logger.info('Customer stories discovered', { storyCount: stories.length });

  const update = {
    knownUrls: stories.map(story => story.url),
    stories,
    lastPolledAt: polledAt,
  };
  await saveCustomerStoryState(update);
  return {
    knownUrls: [...known, ...update.knownUrls],
    stories: [...state.stories, ...stories],
    lastPolledAt: polledAt,
  };
}

async function fetchSitemapUrls(): Promise<string[]> {
  const response = await fetch(SITEMAP_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Customer story sitemap unavailable (${response.status})`);
  const xml = await response.text();
  const locations = xml.match(/<loc>[^<]*<\/loc>/g) || [];
  return [...new Set(locations
    .map(location => location.slice(5, -6).trim())
    .filter(isStoryUrl))];
}

async function fetchStory(url: string, discoveredAt: string): Promise<CustomerStory | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Customer story unavailable (${response.status})`);
    const html = await response.text();
    const meta = (name: string) => {
      const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
      const content = html.match(pattern)?.[0].match(/content=["']([^"']*)["']/i);
      return content?.[1]?.trim() || undefined;
    };
    // og:title omits the " | Sentry" suffix the <title> carries.
    const title = meta('og:title') ||
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim().replace(/\s*\|\s*Sentry\s*$/, '');
    if (!title) throw new Error('Customer story has no title');
    const thumbnail = meta('og:image');
    return {
      url,
      title: decodeEntities(title),
      description: decodeEntities(meta('og:description') || meta('description') || ''),
      publishedAt: discoveredAt,
      ...(thumbnail ? { thumbnail } : {}),
      source: 'customers',
    };
  } catch (error) {
    Sentry.captureException(error);
    Sentry.logger.warn('Customer story details unavailable; retrying next poll', { url });
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
};
function decodeEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const named = ENTITIES[code.toLowerCase()];
    if (named) return named;
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return match;
  });
}
