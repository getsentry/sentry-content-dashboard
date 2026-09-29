import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeContent } from '../src/utils/content';
const require = createRequire(import.meta.url);
const { checkForNewStories, isStoryUrl } = require('../scripts/monitor-customers.js');

let directory: string;
let storageFile: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'customer-stories-'));
  storageFile = path.join(directory, 'customer-stories.json');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const story = (slug: string) => ({ url: `https://sentry.io/customers/${slug}/` });
const read = async () => JSON.parse(await readFile(storageFile, 'utf8'));
const details = async (entry: { url: string }, discoveredAt: string) => ({
  url: entry.url, title: `Story ${entry.url}`, description: 'How they use Sentry',
  publishedAt: discoveredAt, source: 'customers',
});

test.each([
  ['https://sentry.io/customers/', 'the index page itself'],
  ['https://sentry.io/customers/acme/deep/', 'a nested path'],
  ['https://sentry.io/pricing/', 'an unrelated page'],
  ['https://evil.test/customers/acme/', 'another origin'],
  ['https://sentry.io.evil.test/customers/acme/', 'a lookalike origin'],
])('rejects %s as a story URL (%s)', url => {
  expect(isStoryUrl(url)).toBe(false);
});
test('accepts a story URL with or without a trailing slash', () => {
  expect(isStoryUrl('https://sentry.io/customers/acme/')).toBe(true);
  expect(isStoryUrl('https://sentry.io/customers/acme')).toBe(true);
});

test('first run records the existing catalogue without displaying any of it', async () => {
  const fetchStoryDetails = vi.fn(details);
  const displayed = await checkForNewStories({
    storageFile, fetchSitemap: async () => [story('acme'), story('globex')], fetchStoryDetails,
  });
  expect(displayed).toEqual([]);
  // Nothing is fetched or shown on the seeding run: the catalogue is only baselined.
  expect(fetchStoryDetails).not.toHaveBeenCalled();
  const storage = await read();
  expect(storage.stories).toEqual([]);
  expect(storage.knownUrls).toHaveLength(2);
});

test('a story appearing after the baseline is displayed and dated on discovery', async () => {
  let pages = [story('acme')];
  const options = { storageFile, fetchSitemap: async () => pages, fetchStoryDetails: details };
  await checkForNewStories(options);
  const before = Date.now();

  pages = [story('acme'), story('newco')];
  const displayed = await checkForNewStories(options);

  expect(displayed.map((item: { url: string }) => item.url)).toEqual(['https://sentry.io/customers/newco/']);
  const storage = await read();
  expect(storage.stories).toHaveLength(1);
  const discoveredAt = Date.parse(storage.stories[0].publishedAt);
  expect(discoveredAt).toBeGreaterThanOrEqual(before);
  expect(discoveredAt).toBeLessThanOrEqual(Date.now());
});

test('a story already seen is never displayed again', async () => {
  const pages = [story('acme'), story('newco')];
  const options = { storageFile, fetchSitemap: async () => [story('acme')], fetchStoryDetails: details };
  await checkForNewStories(options);
  await checkForNewStories({ ...options, fetchSitemap: async () => pages });
  expect(await checkForNewStories({ ...options, fetchSitemap: async () => pages })).toEqual([]);
  expect((await read()).stories).toHaveLength(1);
});

test('a story whose page fails stays out of the baseline so the next run retries it', async () => {
  const options = { storageFile, fetchSitemap: async () => [story('acme')], fetchStoryDetails: details };
  await checkForNewStories(options);

  const pages = [story('acme'), story('newco')];
  await expect(checkForNewStories({
    ...options, fetchSitemap: async () => pages, fetchStoryDetails: async () => null,
  })).rejects.toThrow('1 stories failed');
  expect((await read()).knownUrls).not.toContain('https://sentry.io/customers/newco/');

  const retried = await checkForNewStories({ ...options, fetchSitemap: async () => pages });
  expect(retried).toHaveLength(1);
});

test('an empty sitemap leaves the baseline untouched instead of re-displaying everything', async () => {
  const options = { storageFile, fetchSitemap: async () => [story('acme')], fetchStoryDetails: details };
  await checkForNewStories(options);
  const before = await read();
  await expect(checkForNewStories({ ...options, fetchSitemap: async () => [] }))
    .rejects.toThrow('No customer stories in sitemap');
  expect(await read()).toEqual(before);
});

test('corrupt storage is rejected rather than silently reseeded', async () => {
  await writeFile(storageFile, JSON.stringify({ stories: 'not an array' }));
  await expect(checkForNewStories({ storageFile, fetchSitemap: async () => [story('acme')] }))
    .rejects.toThrow('Invalid customer story storage');
});

test('the source loader normalizes stored stories for the dashboard', async () => {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    const dataDirectory = path.join(directory, 'data');
    await rm(dataDirectory, { recursive: true, force: true });
    const { load } = await import('../src/server/sources/customers');
    // No storage file yet: an unmonitored deploy shows nothing rather than failing.
    expect((await load()).items).toEqual([]);

    await mkdir(dataDirectory, { recursive: true });
    await writeFile(path.join(dataDirectory, 'customer-stories.json'), JSON.stringify({
      stories: [
        { url: 'https://sentry.io/customers/older/', title: 'Older', description: '', publishedAt: '2026-09-01T00:00:00.000Z' },
        { url: 'https://sentry.io/customers/newer/', title: 'Newer', description: '', publishedAt: '2026-09-20T00:00:00.000Z' },
      ],
    }));
    const { items } = await load();
    expect(items.map(item => item.title)).toEqual(['Newer', 'Older']);
    expect(items.every(item => item.source === 'customers')).toBe(true);
  } finally { cwd.mockRestore(); }
});

test('customer stories are categorised as business content', () => {
  const [item] = normalizeContent([{
    url: 'https://sentry.io/customers/acme/', title: 'How Acme ships faster',
    description: 'A story about shipping', publishedAt: '2026-09-20T00:00:00.000Z',
  }], 'customers');
  expect(item.categories).toContain('business');
});
