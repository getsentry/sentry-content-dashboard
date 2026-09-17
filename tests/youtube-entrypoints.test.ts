import { afterEach, expect, test, vi } from 'vitest';
vi.mock('../config', () => ({ config: { youtube: { apiKey: 'fake-key', channelId: 'test', maxResults: 50 }, content: { daysToShow: 90 } } }));
vi.mock('../src/server/sources/docs', () => ({ load: async () => ({ items: [] }) }));
import { GET as stream } from '../src/app/api/content/route';
import { GET as youtube } from '../src/app/api/youtube/route';
import { GET as markdown } from '../src/app/api/export/markdown/route';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test('stream, source API, and export share quota; failed upstream calls still consume admission', async () => {
  vi.stubEnv('REDIS_URL', ''); vi.stubEnv('VERCEL', ''); vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('YOUTUBE_REFRESH_INTERVAL_MS', '1'); vi.stubEnv('YOUTUBE_MAX_REFRESHES_PER_DAY', '2');
  vi.useFakeTimers();
  let youtubeCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (new URL(url).origin === 'https://www.googleapis.com') {
      youtubeCalls++;
      if (youtubeCalls === 2) return new Response('', { status: 500 });
      return Response.json({ items: [{ id: { videoId: 'one' }, snippet: { title: 'Saved video', description: '', publishedAt: new Date().toISOString(), thumbnails: { medium: { url: 'https://example.com/thumb' } } } }] });
    }
    return new Response('<rss><channel/></rss>');
  }));
  expect(await (await stream(new Request('https://app.test/api/content?refresh=1'))).text()).toContain('Saved video');
  expect(youtubeCalls).toBe(1);
  await vi.advanceTimersByTimeAsync(30001);
  expect((await youtube()).status).toBe(503); // the failed second attempt is charged
  await vi.advanceTimersByTimeAsync(30001);
  const exported = await markdown();
  expect(await exported.text()).toContain('refresh deferred: youtube');
  const response = await youtube();
  expect(response.headers.get('X-Content-Refresh')).toBe('deferred');
  expect(await response.text()).toContain('Saved video');
  const streamed = await (await stream(new Request('https://app.test/api/content?refresh=1'))).text();
  expect(streamed).toContain('refreshDeferredUntil');
  expect(streamed).toContain('"type":"done"');
  expect(youtubeCalls).toBe(2);
});
