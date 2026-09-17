import { afterEach, expect, test, vi } from 'vitest';
const storage = vi.hoisted(() => ({ getChangelogEntries: vi.fn(), getRedisClient: vi.fn() }));
vi.mock('../src/utils/changelogStorage', () => storage);
vi.mock('fs/promises', () => ({ readFile: vi.fn(async () => JSON.stringify({ knownPages: [] })) }));
vi.mock('../config', () => ({ config: { youtube: { apiKey: 'test-key', channelId: 'channel', maxResults: 50 }, content: { daysToShow: 90 } } }));
import { load as youtube } from '../src/server/sources/youtube';
import { load as docs } from '../src/server/sources/docs';
import { RefreshDeferredError } from '../src/server/cacheErrors';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

function youtubeFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    const resource = new URL(url).pathname.split('/').at(-1);
    if (resource === 'channels') return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] });
    if (resource === 'playlistItems') return Response.json({ items: [
      { snippet: { title: 'Private video' } },
      { contentDetails: { videoId: 'fresh', videoPublishedAt: new Date().toISOString() }, snippet: { title: 'Fresh video' } },
      { contentDetails: { videoId: 'old', videoPublishedAt: '2020-01-01' }, snippet: { title: 'Old video', publishedAt: new Date().toISOString() } },
    ] });
    throw new Error('Expensive search must not bypass Redis admission');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

test('production cold start without Redis recovers videos without spending search quota', async () => {
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('REDIS_URL', '');
  const fetchMock = youtubeFetch();
  const result = await youtube();
  expect(result.items).toMatchObject([{ id: 'fresh', title: 'Fresh video', source: 'youtube' }]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('Redis outage recovers uploads, while actual quota deferral remains enforced', async () => {
  vi.stubEnv('REDIS_URL', 'redis://test');
  storage.getRedisClient.mockRejectedValueOnce(Error('Connection timeout'));
  const fetchMock = youtubeFetch();
  expect((await youtube()).items).toHaveLength(1);
  fetchMock.mockClear();
  storage.getRedisClient.mockResolvedValue({ eval: async () => Date.now() + 60000 });
  await expect(youtube()).rejects.toBeInstanceOf(RefreshDeferredError);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('upstream uploads failure stays an error instead of silently returning zero videos', async () => {
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('REDIS_URL', '');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
  await expect(youtube()).rejects.toThrow('YouTube channels request failed (403)');
});

const commit = { sha: 'abc', html_url: 'https://github.com/getsentry/sentry-docs/commit/abc',
  commit: { message: 'Update SDK docs\n\nDetails', author: { name: 'Author', date: '2026-09-16T14:20:06Z' } } };

test.each(['empty', 'unavailable'])('Docs recovers live history from %s storage and deduplicates paths', async state => {
  if (state === 'empty') storage.getChangelogEntries.mockResolvedValue([]);
  else storage.getChangelogEntries.mockRejectedValue(Error('Redis unavailable'));
  const fetchMock = vi.fn(async () => Response.json([commit]));
  vi.stubGlobal('fetch', fetchMock);
  const result = await docs();
  expect(result.items).toMatchObject([{ id: 'docs-abc', publishedAt: '2026-09-16T14:20:06.000Z', source: 'docs' }]);
  expect(fetchMock.mock.calls).toHaveLength(2);
});

test('healthy Docs history preserves stored summaries without a GitHub dependency', async () => {
  storage.getChangelogEntries.mockResolvedValue([{ id: 'stored', title: 'Stored summary', description: 'AI summary',
    url: commit.html_url, publishedAt: '2026-09-16', source: 'docs' }]);
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  expect((await docs()).items[0].description).toBe('AI summary');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('Docs reports failure when both storage and GitHub are unavailable', async () => {
  storage.getChangelogEntries.mockRejectedValue(Error('Redis unavailable'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
  await expect(docs()).rejects.toThrow('GitHub docs history request failed (403)');
});
