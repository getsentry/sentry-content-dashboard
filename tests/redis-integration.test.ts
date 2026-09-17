import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import Redis from 'ioredis';
const shared = vi.hoisted(() => ({ redis: undefined as unknown as import('ioredis').default }));
vi.mock('../src/utils/changelogStorage', () => ({ getRedisClient: async () => shared.redis }));
import { redisSnapshots } from '../src/server/redisSnapshots';
import { SourceCache } from '../src/server/sourceCache';
import { RESERVE_YOUTUBE } from '../src/server/youtubeQuota';
import { randomUUID } from 'node:crypto';
const url = process.env.REDIS_TEST_URL;
const key = `test:youtube:admission:${randomUUID()}`;
// Only the explicit isolated test service is used, never the app's REDIS_URL.
beforeAll(async () => { if (url) { shared.redis = new Redis(url); await shared.redis.ping(); } });
afterAll(async () => { if (url) { await shared.redis.del(key, 'content:v1:blog', 'content:v1:blog:lock'); await shared.redis.quit(); } });
test.skipIf(!url)('real Redis atomically admits one of multiple workers and expires the rolling budget', async () => {
  const reserve = (interval: number, max: number) => shared.redis.eval(RESERVE_YOUTUBE, 1, key, interval, max, randomUUID());
  const attempts = await Promise.all(Array.from({ length: 8 }, () => reserve(100, 1)));
  expect(attempts.filter(value => value === 0)).toHaveLength(1);
  expect(await shared.redis.zcard(key)).toBe(1);
  await shared.redis.del(key);
  await shared.redis.zadd(key, Date.now() - 86400001, 'expired');
  expect(await reserve(100, 1)).toBe(0);
});
test.skipIf(!url)('real Redis coordinates cold workers and expired owners cannot publish or unlock', async () => {
  await shared.redis.del('content:v1:blog', 'content:v1:blog:lock');
  let finish!: (value: { items: unknown[] }) => void;
  const load = vi.fn(() => new Promise<{ items: unknown[] }>(resolve => { finish = resolve; }));
  const loaders = { blog: load, youtube: load, docs: load, changelog: load };
  const a = new SourceCache(loaders, redisSnapshots).refresh('blog', true);
  const b = new SourceCache(loaders, redisSnapshots).refresh('blog', true);
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  finish({ items: [] });
  expect(await a).toEqual(await b);
  expect(load).toHaveBeenCalledOnce();
  await shared.redis.del('content:v1:blog');
  await expect(redisSnapshots.refresh('blog', undefined, async () => {
    await shared.redis.pexpire('content:v1:blog:lock', 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await shared.redis.set('content:v1:blog:lock', 'new-owner', 'PX', 1000, 'NX')).toBe('OK');
    return { items: [], fetchedAt: Date.now() };
  })).rejects.toThrow('lease expired');
  expect(await shared.redis.get('content:v1:blog:lock')).toBe('new-owner');
  expect(await shared.redis.get('content:v1:blog')).toBeNull();
});

test.skipIf(!url)('slow cold read still revalidates a pre-existing Redis snapshot on first visit', async () => {
  await shared.redis.del('content:v1:blog:lock');
  await shared.redis.set('content:v1:blog', JSON.stringify({ items: [], fetchedAt: Date.now() - 10000 }));
  const slowStore = { ...redisSnapshots, read: async (source: Parameters<typeof redisSnapshots.read>[0]) => {
    await new Promise(resolve => setTimeout(resolve, 650));
    return redisSnapshots.read(source);
  } };
  const load = vi.fn(async () => ({ items: [{ title: 'New on first visit', url: 'https://example.com/new', publishedAt: '2026-09-17' }] }));
  const cache = new SourceCache({ blog: load, docs: load, youtube: load, changelog: load }, slowStore);
  expect((await cache.refresh('blog', true)).items[0].title).toBe('New on first visit');
  expect(load).toHaveBeenCalledOnce();
});

test.skipIf(!url)('slow background read reuses warm Redis data while forced deferral retains it', async () => {
  const { RefreshDeferredError } = await import('../src/server/cacheErrors');
  await shared.redis.del('content:v1:blog:lock');
  const saved = { items: [{ id: 'saved', source: 'blog', title: 'Saved content', description: '', categories: [], url: 'https://example.com', publishedAt: '2026-09-17' }], etag: 'saved-version', fetchedAt: Date.now() - 10000 };
  await shared.redis.set('content:v1:blog', JSON.stringify(saved));
  const slowStore = { ...redisSnapshots, read: async (source: Parameters<typeof redisSnapshots.read>[0]) => {
    await new Promise(resolve => setTimeout(resolve, 650));
    return redisSnapshots.read(source);
  } };
  const load = vi.fn(async () => { throw new RefreshDeferredError(Date.now() + 10000); });
  const loaders = { blog: load, docs: load, youtube: load, changelog: load };
  const background = new SourceCache(loaders, slowStore);
  expect((await background.refresh('blog')).items[0].title).toBe('Saved content');
  expect(load).not.toHaveBeenCalled();
  const firstVisit = new SourceCache(loaders, slowStore);
  const deferred = await firstVisit.refresh('blog', true);
  expect(deferred.items[0].title).toBe('Saved content');
  expect(deferred.fetchedAt).toBe(saved.fetchedAt);
  expect(deferred.refreshDeferredUntil).toBeGreaterThan(Date.now());
  expect(load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ etag: 'saved-version' }));
});
