import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ChangelogEntry } from '../src/utils/changelogStorage';
const redis = vi.hoisted(() => ({ get: vi.fn(), eval: vi.fn(), connect: vi.fn(), on: vi.fn() }));
vi.mock('ioredis', () => ({ default: class { get = redis.get; eval = redis.eval; connect = redis.connect; on = redis.on; } }));
import { saveChangelogEntry } from '../src/utils/changelogStorage';
const entry = (id: string, publishedAt = '2026-09-16T00:00:00Z') => ({ id, publishedAt } as ChangelogEntry);
beforeEach(() => { vi.stubEnv('REDIS_URL', 'redis://test'); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());
test('Redis CAS conflicts reload concurrent history before writing', async () => {
  redis.get.mockResolvedValueOnce('[]').mockResolvedValueOnce(JSON.stringify([entry('other')]));
  redis.eval.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  await saveChangelogEntry(entry('mine'));
  expect(redis.get).toHaveBeenCalledTimes(2);
  const written = JSON.parse(redis.eval.mock.calls[1][4]);
  expect(written.map((item: ChangelogEntry) => item.id).sort()).toEqual(['mine', 'other']);
});
test('Redis corrupt history never reaches the compare-and-set write', async () => {
  redis.get.mockResolvedValue('{broken');
  await expect(saveChangelogEntry(entry('mine'))).rejects.toThrow();
  expect(redis.eval).not.toHaveBeenCalled();
});
test('Redis retention orders legacy timezone offsets by their actual timestamps', async () => {
  const old = Array.from({ length: 99 }, (_, i) => entry(`old-${i}`, '2026-01-01'));
  redis.get.mockResolvedValue(JSON.stringify([...old, entry('latest', '2026-09-15T23:00:00-07:00')]));
  redis.eval.mockResolvedValue(1);
  await saveChangelogEntry(entry('mine', '2026-09-16T01:00:00Z'));
  const written = JSON.parse(redis.eval.mock.calls[0][4]);
  expect(written).toHaveLength(100);
  expect(written[0].id).toBe('latest');
  expect(written[1].id).toBe('mine');
});
