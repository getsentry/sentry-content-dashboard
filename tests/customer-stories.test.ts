import { afterEach, expect, test, vi } from 'vitest';
import { load, parseListingDate, parseStories } from '../src/server/sources/customers';
import { normalizeContent } from '../src/utils/content';

afterEach(() => { vi.unstubAllGlobals(); });

/** A card in the shape the listing page serves. */
function card({ slug, title, date, description = 'A story', image = `/_astro/${slug}.webp` }: {
  slug: string; title: string | null; date: string | null; description?: string; image?: string | null;
}) {
  return `<div data-original-index="0">
    <a href="/customers/${slug}/" class="customer-tile block relative bg-white rounded-lg">
      <div class="relative w-full h-[137px] overflow-hidden">
        ${image === null ? '' : `<img src="${image}" alt="${slug}" loading="lazy" class="w-full">`}
      </div>
      <div class="p-4 flex flex-col gap-2 flex-1">
        ${title === null ? '' : `<h3 class="text-[20px] font-semibold leading-[1.5] text-[#333232]"> ${title} </h3>`}
        ${date === null ? '' : `<p class="text-[14px] font-medium uppercase leading-[1.25] text-[#333232]"> ${date} </p>`}
        <p class="text-[14px] font-normal leading-[1.25] text-[#333232]"> ${description} </p>
      </div>
    </a>
  </div>`;
}
const listing = (cards: string[]) => `<html><body><main>${cards.join('\n')}</main></body></html>`;
const serve = (html: string, status = 200) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status })));

test('parses each card into a story with its published date', () => {
  const [story] = parseStories(listing([
    card({ slug: 'exa', title: 'How Exa keeps search working', date: 'Sep 25, 2026', description: 'Exa builds a search API.' }),
  ]));
  expect(story).toMatchObject({
    id: 'customers-exa',
    url: 'https://sentry.io/customers/exa/',
    title: 'How Exa keeps search working',
    description: 'Exa builds a search API.',
    publishedAt: '2026-09-25T00:00:00.000Z',
    thumbnail: 'https://sentry.io/_astro/exa.webp',
    source: 'customers',
  });
});

test('resolves relative card images and keeps absolute ones', () => {
  const stories = parseStories(listing([
    card({ slug: 'relative', title: 'Relative', date: 'Jan 2, 2026' }),
    card({ slug: 'absolute', title: 'Absolute', date: 'Jan 3, 2026', image: 'https://i.vimeocdn.com/video/1-d_1280?region=us' }),
    card({ slug: 'imageless', title: 'Imageless', date: 'Jan 4, 2026', image: null }),
  ]));
  expect(stories.map(story => story.thumbnail)).toEqual([
    'https://sentry.io/_astro/relative.webp',
    'https://i.vimeocdn.com/video/1-d_1280?region=us',
    undefined,
  ]);
});

test('decodes entities and strips nested markup from card text', () => {
  const [story] = parseStories(listing([
    card({
      slug: 'acme', title: 'Acme&#39;s <span class="x">Sentry</span> Story',
      date: 'Mar 1, 2026', description: 'Faster &amp; safer &mdash; they say',
    }),
  ]));
  expect(story.title).toBe("Acme's Sentry Story");
  expect(story.description).toBe('Faster & safer — they say');
});

test.each([
  ['Aug 12, 2025', '2025-08-12T00:00:00.000Z'],
  ['Sep 25, 2026', '2026-09-25T00:00:00.000Z'],
  ['September 25, 2026', '2026-09-25T00:00:00.000Z'],
  ['Sep. 25 2026', '2026-09-25T00:00:00.000Z'],
  ['JAN 1, 2020', '2020-01-01T00:00:00.000Z'],
])('reads %s as %s', (value, expected) => {
  expect(parseListingDate(value)).toBe(expected);
});

test.each(['', 'Smarch 4, 2026', 'Feb 31, 2026', '2026-09-25', 'Sep 2026', 'coming soon', undefined])(
  'rejects %s as a date', value => { expect(parseListingDate(value)).toBeUndefined(); });

test('dates are timezone independent', () => {
  // A date parsed as local midnight would shift a day behind UTC here.
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati';
    expect(parseListingDate('Aug 12, 2025')).toBe('2025-08-12T00:00:00.000Z');
    process.env.TZ = 'Pacific/Niue';
    expect(parseListingDate('Aug 12, 2025')).toBe('2025-08-12T00:00:00.000Z');
  } finally { process.env.TZ = original; }
});

test('a card missing a title or a usable date is skipped rather than guessed at', () => {
  const stories = parseStories(listing([
    card({ slug: 'good', title: 'Good', date: 'Feb 2, 2026' }),
    card({ slug: 'undated', title: 'Undated', date: 'Coming soon' }),
    card({ slug: 'untitled', title: '', date: 'Feb 3, 2026' }),
  ]));
  expect(stories.map(story => story.id)).toEqual(['customers-good']);
});

test('a card with no date element does not inherit the next card\'s', () => {
  const stories = parseStories(listing([
    card({ slug: 'undated', title: 'Undated', date: null }),
    card({ slug: 'dated', title: 'Dated', date: 'Feb 2, 2026' }),
  ]));
  expect(stories.map(story => story.id)).toEqual(['customers-dated']);
});

test('a card with unparseable date text is skipped', () => {
  const stories = parseStories(listing([
    card({ slug: 'undated', title: 'Undated', date: 'Coming soon' }),
    card({ slug: 'dated', title: 'Dated', date: 'Feb 2, 2026' }),
  ]));
  expect(stories.map(story => story.id)).toEqual(['customers-dated']);
});

test('a card missing an image does not inherit the next card\'s', () => {
  const stories = parseStories(listing([
    card({ slug: 'imageless', title: 'Imageless', date: 'Feb 2, 2026', image: null }),
    card({ slug: 'pictured', title: 'Pictured', date: 'Feb 3, 2026' }),
  ]));
  expect(stories.map(story => story.thumbnail)).toEqual([undefined, 'https://sentry.io/_astro/pictured.webp']);
});

test('a card missing its title does not inherit the next card\'s', () => {
  const stories = parseStories(listing([
    card({ slug: 'untitled', title: null, date: 'Feb 2, 2026' }),
    card({ slug: 'titled', title: 'Titled', date: 'Feb 3, 2026' }),
  ]));
  expect(stories.map(story => story.id)).toEqual(['customers-titled']);
});

test('a story listed twice is kept once', () => {
  const stories = parseStories(listing([
    card({ slug: 'acme', title: 'Acme', date: 'Feb 2, 2026' }),
    card({ slug: 'acme', title: 'Acme featured again', date: 'Feb 2, 2026' }),
  ]));
  expect(stories).toHaveLength(1);
  expect(stories[0].title).toBe('Acme');
});

test('unrelated links are not mistaken for story cards', () => {
  const stories = parseStories(`<html>
    <a href="/customers/" class="nav-link">All customer stories</a>
    <a href="/pricing/" class="customer-tile"><h3>Pricing</h3><p class="uppercase">Feb 2, 2026</p></a>
    ${card({ slug: 'acme', title: 'Acme', date: 'Feb 2, 2026' })}
  </html>`);
  expect(stories.map(story => story.url)).toEqual(['https://sentry.io/customers/acme/']);
});

test('the source serves stories newest first', async () => {
  serve(listing([
    card({ slug: 'older', title: 'Older', date: 'Jan 5, 2026' }),
    card({ slug: 'newest', title: 'Newest', date: 'Sep 5, 2026' }),
    card({ slug: 'middle', title: 'Middle', date: 'Jun 5, 2026' }),
  ]));
  const { items } = await load();
  expect(items.map(item => item.title)).toEqual(['Newest', 'Middle', 'Older']);
  expect(items.every(item => item.source === 'customers')).toBe(true);
});

test('an unavailable listing page fails instead of reporting no stories', async () => {
  serve('nope', 503);
  await expect(load()).rejects.toThrow('Customer stories unavailable (503)');
});

test('markup that yields no stories fails so the last good snapshot stays visible', async () => {
  serve('<html><body><p>Customer stories are moving!</p></body></html>');
  await expect(load()).rejects.toThrow('listing markup may have changed');
});

test('customer stories are categorised as business content', () => {
  const [item] = normalizeContent([{
    url: 'https://sentry.io/customers/acme/', title: 'How Acme ships faster',
    description: 'A story about shipping', publishedAt: '2026-09-20T00:00:00.000Z',
  }], 'customers');
  expect(item.categories).toContain('business');
});
