import { beforeEach, expect, test, vi } from 'vitest';
import { SourceCache } from '../src/server/sourceCache';
const redis = vi.hoisted(() => {
  const data = new Map<string, string>();
  return { data, get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { if (data.has(key)) return null; data.set(key, value); return 'OK'; }),
    eval: vi.fn(async (_script: string, count: number, ...args: string[]) => {
      const [lock] = args;
      if (count === 1) { if (data.get(lock) === args[1]) data.delete(lock); return 1; }
      const [, key, token, value] = args;
      if (data.get(lock) !== token) return 0;
      data.set(key, value); data.delete(lock); return 1;
    }),
  };
});
vi.mock('../src/utils/changelogStorage', () => ({ getRedisClient: async () => redis }));
import { redisSnapshots } from '../src/server/redisSnapshots';
beforeEach(() => { redis.data.clear(); vi.clearAllMocks(); });
test('two separate workers coordinate one shared source refresh', async () => {
  let finish!: (value: { items: unknown[] }) => void;
  const load = vi.fn(() => new Promise<{ items: unknown[] }>(resolve => { finish = resolve; }));
  const loaders = { blog: load, docs: load, youtube: load, changelog: load };
  const first = new SourceCache(loaders, redisSnapshots);
  const second = new SourceCache(loaders, redisSnapshots);
  const a = first.refresh('blog', true); const b = second.refresh('blog', true);
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  finish({ items: [{ title: 'Shared', url: 'https://example.com', publishedAt: '2026-09-17' }] });
  expect(await b).toEqual(await a);
  expect(load).toHaveBeenCalledOnce();
  expect(redis.data.has('content:v1:blog:lock')).toBe(false);
});
test('an expired lease cannot overwrite a newer writer or release its lock', async () => {
  const result = redisSnapshots.refresh('blog', undefined, async () => {
    redis.data.set('content:v1:blog:lock', 'new-owner');
    return { items: [], fetchedAt: Date.now() };
  });
  await expect(result).rejects.toThrow('lease expired');
  expect(redis.data.get('content:v1:blog:lock')).toBe('new-owner');
  expect(redis.data.has('content:v1:blog')).toBe(false);
});

test('waiting workers reuse a slow owner result instead of starting another fetch', async () => {
  vi.useFakeTimers();
  try {
    redis.data.set('content:v1:blog:lock', 'owner');
    const load = vi.fn();
    const result = redisSnapshots.refresh('blog', undefined, load);
    await vi.advanceTimersByTimeAsync(5000);
    redis.data.set('content:v1:blog', JSON.stringify({ items: [], fetchedAt: Date.now() }));
    await vi.advanceTimersByTimeAsync(101);
    expect((await result).items).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
test('an expired competing lease cannot start a new fetch after the acquisition budget', async () => {
  vi.useFakeTimers();
  try {
    redis.data.set('content:v1:blog:lock', 'owner');
    const load = vi.fn();
    const result = redisSnapshots.refresh('blog', undefined, load);
    const rejection = expect(result).rejects.toThrow('busy');
    await vi.advanceTimersByTimeAsync(3000);
    redis.data.delete('content:v1:blog:lock');
    await vi.advanceTimersByTimeAsync(15100);
    await rejection;
    expect(load).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
test('unlock failure does not hide an upstream failure', async () => {
  redis.eval.mockRejectedValueOnce(Error('unlock failure'));
  await expect(redisSnapshots.refresh('blog', undefined, async () => {
    throw Error('upstream failure');
  })).rejects.toThrow('upstream failure');
});

test('cold forced refresh does not accept an old Redis snapshot when previous read timed out', async () => {
  redis.data.set('content:v1:blog', JSON.stringify({ items: [], fetchedAt: Date.now() - 60000 }));
  const fresh = { items: [], fetchedAt: Date.now() };
  const load = vi.fn(async () => fresh);
  expect(await redisSnapshots.refresh('blog', undefined, load, Date.now())).toEqual(fresh);
  expect(load).toHaveBeenCalledOnce();
});
