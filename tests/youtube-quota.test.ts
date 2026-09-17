import { afterEach, expect, test, vi } from 'vitest';
const redis = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock('../src/utils/changelogStorage', () => ({ getRedisClient: async () => redis }));
import { LocalYouTubeAdmission, reserveYouTubeRefresh } from '../src/server/youtubeQuota';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
test('rolling local budget protects sequential calls, interval boundary, and expiry', () => {
  const limiter = new LocalYouTubeAdmission();
  expect(limiter.reserve(0, 20, 2)).toBe(0);
  expect(limiter.reserve(19, 20, 2)).toBe(20);
  expect(limiter.reserve(20, 20, 2)).toBe(0);
  expect(limiter.reserve(40, 20, 2)).toBe(86400000);
  expect(limiter.reserve(86400000, 20, 2)).toBe(0);
});
test('configured admission failure fails closed without local bypass', async () => {
  vi.stubEnv('REDIS_URL', 'redis://test');
  redis.eval.mockRejectedValue(Error('Redis unavailable'));
  await expect(reserveYouTubeRefresh()).rejects.toThrow('deferred');
});
test('production without shared admission cannot spend quota', async () => {
  vi.stubEnv('REDIS_URL', ''); vi.stubEnv('NODE_ENV', 'production');
  await expect(reserveYouTubeRefresh()).rejects.toThrow('deferred');
  expect(redis.eval).not.toHaveBeenCalled();
});
test('reservation happens atomically before upstream and returns retry time', async () => {
  vi.stubEnv('REDIS_URL', 'redis://test');
  redis.eval.mockResolvedValueOnce(0).mockResolvedValueOnce(Date.now() + 10000);
  await reserveYouTubeRefresh();
  await expect(reserveYouTubeRefresh()).rejects.toThrow('deferred');
  expect(redis.eval.mock.calls[0].slice(1, 5)).toEqual([1, 'content:v1:youtube:admission', 1200000, 90]);
});
