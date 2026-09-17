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

test('slow shared read keeps coordination enabled and late results cannot replace newer data', async () => {
  vi.useFakeTimers();
  let finish!: (value: import('../src/utils/content').SourceSnapshot) => void;
  const store: SnapshotStore = { read: vi.fn(() => new Promise(resolve => { finish = resolve; })),
    refresh: vi.fn(async (_source, _previous, load) => load()) };
  const cache = new SourceCache(loaders(async () => ({ items: [item('New')] })), store);
  const reading = cache.read('blog');
  await vi.advanceTimersByTimeAsync(401); await reading;
  const refreshing = cache.refresh('blog', true);
  await vi.advanceTimersByTimeAsync(401);
  const fresh = await refreshing;
  expect(store.refresh).toHaveBeenCalledOnce();
  finish({ items: [], fetchedAt: fresh.fetchedAt - 1 });
  await vi.advanceTimersByTimeAsync(1);
  const result = cache.read('blog');
  await vi.advanceTimersByTimeAsync(401);
  expect((await result)?.items[0].title).toBe('New');
});
test('a late Redis rejection is handled and healthy loaders still work', async () => {
  vi.useFakeTimers();
  const store: SnapshotStore = { read: () => new Promise((_resolve, reject) => setTimeout(() => reject(Error('late Redis failure')), 500)), refresh: vi.fn() };
  const cache = new SourceCache(loaders(async () => ({ items: [item('Available')] })), store);
  const reading = cache.read('blog');
  await vi.advanceTimersByTimeAsync(501); await reading;
  expect((await cache.refresh('blog')).items[0].title).toBe('Available');
});
test('lease loss does not disable another source and contention never bypasses its owner', async () => {
  const { RefreshCoordinationError } = await import('../src/server/cacheErrors');
  const load = vi.fn(async () => ({ items: [item('Fresh')] }));
  const store: SnapshotStore = { read: async () => undefined, refresh: vi.fn(async (source, _previous, refresh) => {
    if (source === 'changelog') throw new RefreshCoordinationError('busy');
    const value = await refresh();
    if (source === 'blog') throw new RefreshCoordinationError('lease expired');
    return value;
  }) };
  const cache = new SourceCache(loaders(load), store);
  await cache.refresh('blog'); await cache.refresh('docs');
  await expect(cache.refresh('changelog')).rejects.toThrow('busy');
  expect(store.refresh).toHaveBeenCalledTimes(3);
  expect(load).toHaveBeenCalledTimes(2);
});
test('deferred refresh retains original freshness timestamp and does not poison other sources', async () => {
  const { RefreshDeferredError } = await import('../src/server/cacheErrors');
  const load = vi.fn().mockResolvedValue({ items: [item('Saved')] });
  const cache = new SourceCache(loaders(load));
  const original = await cache.refresh('youtube');
  load.mockRejectedValue(new RefreshDeferredError(Date.now() + 10000));
  const deferred = await cache.refresh('youtube', true);
  expect(deferred.fetchedAt).toBe(original.fetchedAt);
  expect(deferred.refreshDeferredUntil).toBeGreaterThan(Date.now());
  load.mockResolvedValue({ items: [item('New')] });
  expect((await cache.refresh('youtube', true)).items[0].title).toBe('New');
});

test('busy refresh returns labeled saved content and immediate retry reads the owner result', async () => {
  const { RefreshCoordinationError } = await import('../src/server/cacheErrors');
  const saved = { items: normalizeForTest('Saved'), fetchedAt: Date.now() - 10000 };
  let stored = saved;
  const store: SnapshotStore = { read: async () => stored, refresh: vi.fn(async () => {
    throw new RefreshCoordinationError('busy');
  }) };
  const load = vi.fn();
  const cache = new SourceCache(loaders(load), store);
  const result = await cache.refresh('blog', true);
  expect(result.refreshBusy).toBe(true);
  expect(result.items[0].title).toBe('Saved');
  stored = { items: normalizeForTest('Owner published'), fetchedAt: Date.now() };
  expect((await cache.refresh('blog')).items[0].title).toBe('Owner published');
  expect(load).not.toHaveBeenCalled();
});
test('coordination failure without a snapshot also permits an immediate retry', async () => {
  const { RefreshCoordinationError } = await import('../src/server/cacheErrors');
  const store: SnapshotStore = { read: async () => undefined,
    refresh: vi.fn().mockRejectedValueOnce(new RefreshCoordinationError('busy')).mockImplementationOnce(async (_s, _p, load) => load()) };
  const cache = new SourceCache(loaders(async () => ({ items: [item('Available')] })), store);
  await expect(cache.refresh('blog')).rejects.toThrow('busy');
  expect((await cache.refresh('blog')).items[0].title).toBe('Available');
});
function normalizeForTest(title: string) {
  return [{ ...item(title), id: 'blog-test', source: 'blog' as const, description: '', categories: [] }];
}

test('successful conditional refresh strips response-only status and deferrals are never cached', async () => {
  const { RefreshDeferredError } = await import('../src/server/cacheErrors');
  const load = vi.fn().mockResolvedValue({ items: [item('Saved')], etag: 'version-1' });
  const cache = new SourceCache(loaders(load));
  const original = await cache.refresh('youtube');
  load.mockRejectedValueOnce(new RefreshDeferredError(Date.now() + 1));
  expect((await cache.refresh('youtube', true)).refreshDeferredUntil).toBeDefined();
  expect((await cache.read('youtube'))?.refreshDeferredUntil).toBeUndefined();
  // A 304 loader may return its input object. Do not persist response metadata even
  // if a future caller or legacy snapshot supplies it alongside unchanged content.
  load.mockResolvedValue({ ...original, refreshDeferredUntil: Date.now() - 1, refreshBusy: true });
  const refreshed = await cache.refresh('youtube', true);
  expect(refreshed.refreshDeferredUntil).toBeUndefined();
  expect(refreshed.refreshBusy).toBeUndefined();
  expect(refreshed.etag).toBe('version-1');
  expect(refreshed.items).toEqual(original.items);
});

test('store-observed snapshot supplies validators and quota fallback after a missed initial read', async () => {
  const { RefreshDeferredError } = await import('../src/server/cacheErrors');
  const saved = { items: normalizeForTest('Saved video'), fetchedAt: Date.now() - 10000, etag: 'saved' };
  const store: SnapshotStore = { read: async () => undefined, refresh: async (_source, _previous, load) => load(saved) };
  const loader = vi.fn(async () => { throw new RefreshDeferredError(Date.now() + 10000); });
  const cache = new SourceCache(loaders(loader), store);
  const result = await cache.refresh('youtube', true);
  expect(result.items[0].title).toBe('Saved video');
  expect(result.fetchedAt).toBe(saved.fetchedAt);
  expect(result.refreshDeferredUntil).toBeDefined();
  expect(loader).toHaveBeenCalledExactlyOnceWith(saved);
});

test('forced visits upgrade an in-flight cached background read and coalesce forced callers', async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue({ items: [item('Saved')] });
  const cache = new SourceCache(loaders(load));
  await cache.refresh('blog');
  vi.advanceTimersByTime(100);
  load.mockResolvedValue({ items: [item('New')] });
  const background = cache.refresh('blog');
  const forced = cache.refresh('blog', true);
  const another = cache.refresh('blog', true);
  expect(another).toBe(forced);
  expect((await background).items[0].title).toBe('Saved');
  expect((await forced).items[0].title).toBe('New');
  expect(load).toHaveBeenCalledTimes(2);
});
test('forced visits reuse actual upstream work already running for a background read', async () => {
  let finish!: (value: { items: unknown[] }) => void;
  const load = vi.fn(() => new Promise<{ items: unknown[] }>(resolve => { finish = resolve; }));
  const cache = new SourceCache(loaders(load));
  const background = cache.refresh('blog');
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  const forced = cache.refresh('blog', true);
  finish({ items: [item('New')] });
  expect(await forced).toEqual(await background);
  expect(load).toHaveBeenCalledOnce();
});
