import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeContent } from '../src/utils/content';
import { isStoryUrl, load } from '../src/server/sources/customers';
import { getCustomerStoryState, resetBaselineCache } from '../src/utils/customerStoryStorage';
const require = createRequire(import.meta.url);
const { seedBaseline } = require('../scripts/seed-customer-baseline.js');

const SITEMAP = 'https://sentry.io/sitemap/sitemap-0.xml';
const url = (slug: string) => `https://sentry.io/customers/${slug}/`;

let directory: string;
let cwd: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'customer-stories-'));
  await mkdir(path.join(directory, 'data'), { recursive: true });
  cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  resetBaselineCache();
});
afterEach(async () => {
  cwd.mockRestore();
  resetBaselineCache();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

const writeBaseline = (urls: string[]) => writeFile(
  path.join(directory, 'data', 'customer-stories.json'), JSON.stringify({ baselineUrls: urls }));
const readState = async () => JSON.parse(
  await readFile(path.join(directory, 'data', 'customer-stories-state.json'), 'utf8'));

const sitemap = (urls: string[]) =>
  `<urlset>${urls.map(one => `<url><loc>${one}</loc></url>`).join('')}</urlset>`;
const page = (title: string) =>
  `<html><head><meta property="og:title" content="${title}">` +
  `<meta property="og:description" content="How they use Sentry &amp; win">` +
  `<meta property="og:image" content="https://sentry.io/image.webp"></head></html>`;

/** Serves the sitemap and a page per story, counting every request. */
function serve(urls: string[], options: { failing?: string[] } = {}) {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (target: string) => {
    requests.push(target);
    if (target === SITEMAP) return new Response(sitemap(urls));
    if (options.failing?.includes(target)) return new Response('nope', { status: 500 });
    return new Response(page(`Story for ${target}`));
  }));
  return requests;
}

test.each([
  ['https://sentry.io/customers/', 'the index page itself'],
  ['https://sentry.io/customers/acme/deep/', 'a nested path'],
  ['https://sentry.io/pricing/', 'an unrelated page'],
  ['https://evil.test/customers/acme/', 'another origin'],
  ['https://sentry.io.evil.test/customers/acme/', 'a lookalike origin'],
  ['not a url', 'unparseable input'],
])('rejects %s as a story URL (%s)', target => {
  expect(isStoryUrl(target)).toBe(false);
});
test('accepts a story URL with or without a trailing slash', () => {
  expect(isStoryUrl(url('acme'))).toBe(true);
  expect(isStoryUrl('https://sentry.io/customers/acme')).toBe(true);
});

test('the first poll adopts the live catalogue as the baseline and displays none of it', async () => {
  await writeBaseline([]);
  const requests = serve([url('acme'), url('globex')]);

  expect((await load()).items).toEqual([]);
  // Seeding never fetches story pages: the catalogue is only baselined.
  expect(requests).toEqual([SITEMAP]);
  const state = await readState();
  expect(state.stories).toEqual([]);
  expect(state.knownUrls).toHaveLength(2);
});

test('a story appearing after the baseline is displayed and dated on discovery', async () => {
  await writeBaseline([url('acme')]);
  const before = Date.now();
  serve([url('acme'), url('newco')]);

  const { items } = await load();
  expect(items).toHaveLength(1);
  expect(items[0].url).toBe(url('newco'));
  expect(items[0].title).toBe(`Story for ${url('newco')}`);
  expect(items[0].thumbnail).toBe('https://sentry.io/image.webp');
  // HTML entities in og: tags are decoded rather than shown raw.
  expect(items[0].description).toBe('How they use Sentry & win');
  const discoveredAt = Date.parse(items[0].publishedAt);
  expect(discoveredAt).toBeGreaterThanOrEqual(before);
  expect(discoveredAt).toBeLessThanOrEqual(Date.now());
});

test('a baselined story is never displayed, even once others have been discovered', async () => {
  await writeBaseline([url('acme')]);
  serve([url('acme'), url('newco')]);
  await load();

  resetBaselineCache();
  serve([url('acme'), url('newco')]);
  const { items } = await load();
  expect(items.map(item => item.url)).toEqual([url('newco')]);
});

test('the baseline floor keeps the catalogue hidden when runtime state is lost', async () => {
  await writeBaseline([url('acme'), url('globex')]);
  // State was discarded (a flushed cache), but the committed floor remains.
  const requests = serve([url('acme'), url('globex'), url('newco')]);

  const { items } = await load();
  expect(items.map(item => item.url)).toEqual([url('newco')]);
  // Only the genuinely new story is fetched; the floor is not re-walked.
  expect(requests).toEqual([SITEMAP, url('newco')]);
});

test('a later poll within the interval serves stored stories without refetching', async () => {
  await writeBaseline([url('acme')]);
  serve([url('acme'), url('newco')]);
  await load();

  const requests = serve([url('acme'), url('newco'), url('thirdco')]);
  const { items } = await load();
  expect(requests).toEqual([]);
  expect(items.map(item => item.url)).toEqual([url('newco')]);
});

test('a story whose page fails is retried on the next poll instead of being lost', async () => {
  await writeBaseline([url('acme')]);
  serve([url('acme'), url('newco')], { failing: [url('newco')] });
  expect((await load()).items).toEqual([]);
  expect((await readState()).knownUrls).not.toContain(url('newco'));

  // A failed page leaves lastPolledAt set, so force the next poll past the interval.
  const state = await readState();
  await writeFile(path.join(directory, 'data', 'customer-stories-state.json'),
    JSON.stringify({ ...state, lastPolledAt: 0 }));
  serve([url('acme'), url('newco')]);
  expect((await load()).items.map(item => item.url)).toEqual([url('newco')]);
});

test('a sitemap outage serves stored stories rather than clearing them', async () => {
  await writeBaseline([url('acme')]);
  serve([url('acme'), url('newco')]);
  await load();
  const stored = await readState();

  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
  await writeFile(path.join(directory, 'data', 'customer-stories-state.json'),
    JSON.stringify({ ...stored, lastPolledAt: 0 }));
  const { items } = await load();
  expect(items.map(item => item.url)).toEqual([url('newco')]);
  expect((await readState()).knownUrls).toContain(url('newco'));
});

test('an empty sitemap leaves the baseline untouched instead of re-displaying everything', async () => {
  await writeBaseline([url('acme')]);
  serve([url('acme'), url('newco')]);
  await load();
  const before = await readState();

  await writeFile(path.join(directory, 'data', 'customer-stories-state.json'),
    JSON.stringify({ ...before, lastPolledAt: 0 }));
  serve([]);
  expect((await load()).items.map(item => item.url)).toEqual([url('newco')]);
});

test('stories are served newest first', async () => {
  await writeBaseline([]);
  await writeFile(path.join(directory, 'data', 'customer-stories-state.json'), JSON.stringify({
    knownUrls: [url('older'), url('newer')], lastPolledAt: Date.now(),
    stories: [
      { url: url('older'), title: 'Older', description: '', publishedAt: '2026-09-01T00:00:00.000Z', source: 'customers' },
      { url: url('newer'), title: 'Newer', description: '', publishedAt: '2026-09-20T00:00:00.000Z', source: 'customers' },
    ],
  }));
  expect((await load()).items.map(item => item.title)).toEqual(['Newer', 'Older']);
});

test('corrupt runtime state is rejected rather than silently reseeded', async () => {
  await writeBaseline([url('acme')]);
  await writeFile(path.join(directory, 'data', 'customer-stories-state.json'),
    JSON.stringify({ knownUrls: 'not an array', stories: [] }));
  await expect(getCustomerStoryState()).rejects.toThrow('Invalid customer story state');
});

test('a missing baseline file leaves the source empty rather than failing', async () => {
  const state = await getCustomerStoryState();
  expect(state).toEqual({ knownUrls: [], stories: [], lastPolledAt: 0 });
});

test('re-seeding the baseline is refused unless forced, to avoid suppressing new stories', async () => {
  const baselineFile = path.join(directory, 'data', 'customer-stories.json');
  const fetchStoryUrls = async () => [url('acme'), url('newco')];
  await seedBaseline({ baselineFile, fetchStoryUrls });
  expect(JSON.parse(await readFile(baselineFile, 'utf8')).baselineUrls).toHaveLength(2);

  await expect(seedBaseline({ baselineFile, fetchStoryUrls: async () => [url('acme')] }))
    .rejects.toThrow('pass --force to overwrite');
  await seedBaseline({ baselineFile, fetchStoryUrls: async () => [url('acme')], force: true });
  expect(JSON.parse(await readFile(baselineFile, 'utf8')).baselineUrls).toEqual([url('acme')]);
});

test('customer stories are categorised as business content', () => {
  const [item] = normalizeContent([{
    url: url('acme'), title: 'How Acme ships faster',
    description: 'A story about shipping', publishedAt: '2026-09-20T00:00:00.000Z',
  }], 'customers');
  expect(item.categories).toContain('business');
});
