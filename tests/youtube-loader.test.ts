import { afterEach, expect, test, vi } from 'vitest';
vi.mock('../config', () => ({ config: { youtube: { apiKey: 'fake-key', channelId: 'test', maxResults: 50 }, content: { daysToShow: 90 } } }));
vi.mock('../src/server/youtubeQuota', () => ({ reserveYouTubeRefresh: vi.fn().mockResolvedValue(undefined) }));
import { load } from '../src/server/sources/youtube';
afterEach(() => vi.unstubAllGlobals());
test('missing thumbnail sizes never hide otherwise valid videos', async () => {
  const thumbnails = [
    { medium: { url: 'https://example.com/medium' }, default: { url: 'https://example.com/default' } },
    { default: { url: 'https://example.com/default' } },
    { high: { url: 'https://example.com/high' } },
    {}, undefined,
  ];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items: thumbnails.map((thumbnail, index) => ({
    id: { videoId: String(index) }, snippet: { title: `Video ${index}`, description: '',
      publishedAt: new Date().toISOString(), thumbnails: thumbnail },
  })) })));
  const result = await load();
  expect(result.items).toHaveLength(5);
  expect((result.items as Array<{ thumbnail?: string }>).map(item => item.thumbnail)).toEqual([
    'https://example.com/medium', 'https://example.com/default', 'https://example.com/high', undefined, undefined,
  ]);
});
