import * as Sentry from '@sentry/nextjs';
import { normalizeContent } from '../../utils/content';

const SENTRY_BASE_URL = process.env.SENTRY_BASE_URL || 'https://sentry.io';
const LISTING_URL = `${SENTRY_BASE_URL}/customers/`;

// Each customer story carries its publish date on the listing page, alongside
// the title, summary and card image, so one request describes every story. The
// dates are only rendered as text ("Aug 12, 2025"); the page exposes no
// structured date, and neither the sitemap nor the story pages carry one.
export async function load() {
  const response = await fetch(LISTING_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Customer stories unavailable (${response.status})`);
  const stories = parseStories(await response.text());
  // An empty parse means the markup changed. Failing keeps the last good
  // snapshot visible instead of silently emptying the tab.
  if (!stories.length) throw new Error('No customer stories found; listing markup may have changed');
  const items = normalizeContent(stories, 'customers')
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  Sentry.logger.info('Customer story content loaded', { itemCount: items.length });
  return { items };
}

interface ParsedStory {
  id: string;
  url: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail?: string;
  source: 'customers';
}

// Cards look like:
//   <a href="/customers/<slug>/" class="customer-tile ...">
//     <div ...><img src="<thumbnail>" ...></div>
//     <div ...><h3 ...>title</h3>
//       <p class="... uppercase ...">Aug 12, 2025</p>
//       <p class="... font-normal ...">summary</p>
const CARD = /<a href="(\/customers\/[^"/]+\/?)"[^>]*class="[^"]*customer-tile/g;
const CARD_LENGTH = 2500;

export function parseStories(html: string): ParsedStory[] {
  const stories: ParsedStory[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(CARD)) {
    const card = html.slice(match.index + match[0].length, match.index + match[0].length + CARD_LENGTH);
    const title = text(card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
    const published = parseListingDate(text(card.match(/<p[^>]*class="[^"]*\buppercase\b[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]));
    if (!title || !published) continue;

    const url = new URL(match[1], SENTRY_BASE_URL).href;
    if (seen.has(url)) continue;
    seen.add(url);

    const image = card.match(/<img[^>]+src="([^"]+)"/)?.[1];
    const thumbnail = image ? new URL(image, SENTRY_BASE_URL).href : undefined;
    stories.push({
      id: `customers-${match[1].replace(/\/+$/, '').split('/').pop()}`,
      url,
      title,
      description: text(card.match(/<p[^>]*class="[^"]*\bfont-normal\b[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]) || '',
      publishedAt: published,
      ...(thumbnail ? { thumbnail } : {}),
      source: 'customers',
    });
  }
  return stories;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "Aug 12, 2025" -> UTC midnight, so the date never shifts with server timezone.
export function parseListingDate(value: string | undefined): string | undefined {
  const match = value?.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return undefined;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(Number(match[3]), month, day));
  // Reject a rolled-over date such as "Feb 31".
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function text(value: string | undefined) {
  return value && decodeEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

// The listing uses literal UTF-8 for most punctuation, but named entities turn
// up in prose. Anything unrecognised is left as written rather than mangled.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
};
function decodeEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const named = ENTITIES[code.toLowerCase()];
    if (named) return named;
    if (/^#x/i.test(code)) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return match;
  });
}
