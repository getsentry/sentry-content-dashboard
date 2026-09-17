import { afterEach, expect, test, vi } from 'vitest';
import { SourceCache, type SnapshotStore } from '../src/server/sourceCache';
import { load as blog } from '../src/server/sources/blog';
import { load as changelog } from '../src/server/sources/changelog';
const item = (title: string) => ({ title, url: 'https://example.com/post', publishedAt: new Date().toISOString() });
const loaders = (load: () => Promise<{ items: unknown[] }>) => ({ blog: load, docs: load, youtube: load, changelog: load });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
test('simultaneous dashboard/export reads share a single upstream request', async () => {
  let resolve!: (value: { items: unknown[] }) => void;
  const load = vi.fn(() => new Promise<{ items: unknown[] }>(r => { resolve = r; }));
  const cache = new SourceCache(loaders(load));
  const first = cache.refresh('blog', true); const second = cache.refresh('blog');
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  resolve({ items: [item('Fresh')] });
  expect(await second).toEqual(await first);
  await cache.refresh('blog');
  expect(load).toHaveBeenCalledOnce();
});
test('first visit revalidation bypasses freshness, background/export reuses 30-second snapshot', async () => {
  const load = vi.fn().mockResolvedValue({ items: [item('Original')] });
  const cache = new SourceCache(loaders(load));
  await cache.refresh('blog');
  load.mockResolvedValue({ items: [item('Updated')] });
  expect((await cache.refresh('blog')).items[0].title).toBe('Original');
  expect((await cache.refresh('blog', true)).items[0].title).toBe('Updated');
  expect(load).toHaveBeenCalledTimes(2);
});
test('failure retains last good snapshot, backs off, and expires old snapshots', async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue({ items: [item('Good')] });
  const cache = new SourceCache(loaders(load));
  await cache.refresh('blog'); load.mockRejectedValue(Error('upstream down'));
  await expect(cache.refresh('blog', true)).rejects.toThrow('upstream down');
  expect((await cache.read('blog'))?.items[0].title).toBe('Good');
  await expect(cache.refresh('blog', true)).rejects.toThrow('temporarily unavailable');
  expect(load).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(86400001);
  expect(await cache.read('blog')).toBeUndefined();
});
test('optional shared-cache outage does not take a healthy feed offline', async () => {
  const store: SnapshotStore = { read: vi.fn().mockRejectedValue(Error('Redis down')), refresh: vi.fn() };
  const load = vi.fn().mockResolvedValue({ items: [item('Available')] });
  const cache = new SourceCache(loaders(load), store);
  expect((await cache.refresh('blog')).items[0].title).toBe('Available');
  expect(store.refresh).not.toHaveBeenCalled();
});
test.each([['blog', blog], ['changelog', changelog]] as const)('%s uses stable IDs and conditional revalidation', async (_name, load) => {
  const xml = `<rss><channel><item><title>Post</title><link>https://example.com/post</link><pubDate>${new Date().toUTCString()}</pubDate><description>Content</description></item></channel></rss>`;
  const fetchMock = vi.fn().mockResolvedValue(new Response(xml, { headers: { etag: 'version-1' } }));
  vi.stubGlobal('fetch', fetchMock);
  const first = await load();
  fetchMock.mockResolvedValue(new Response(xml));
  const second = await load();
  expect((first.items as {id:string}[])[0].id).toEqual((second.items as {id:string}[])[0].id);
  const previous = { ...first, items: first.items as never[], fetchedAt: Date.now() };
  fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
  expect((await load(previous)).items).toEqual(first.items);
  const headers = fetchMock.mock.calls.at(-1)![1].headers as Headers;
  expect(headers.get('If-None-Match')).toBe('version-1');
});
test('shared-cache write failure still returns fresh upstream data without fetching twice', async () => {
  const load = vi.fn().mockResolvedValue({ items: [item('Available')] });
  const store: SnapshotStore = { read: async () => undefined, refresh: async (_source, _previous, refresh) => {
    await refresh(); throw Error('Redis write failed');
  } };
  const cache = new SourceCache(loaders(load), store);
  expect((await cache.refresh('blog')).items[0].title).toBe('Available');
  expect(load).toHaveBeenCalledOnce();
});
