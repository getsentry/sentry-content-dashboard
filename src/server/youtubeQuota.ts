import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nextjs';
import { getRedisClient } from '../utils/changelogStorage';
import { RefreshDeferredError } from './cacheErrors';

const DAY_MS = 86400000;
const KEY = 'content:v1:youtube:admission';
// A rolling 24-hour budget is conservative across quota reset boundaries.
export const RESERVE_YOUTUBE = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 86400000)
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #latest > 0 and tonumber(latest[2]) + tonumber(ARGV[1]) > now then
  return tonumber(latest[2]) + tonumber(ARGV[1])
end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return tonumber(oldest[2]) + 86400000
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], 86400000)
return 0`;

function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid YouTube quota configuration');
  return number;
}

export class LocalYouTubeAdmission {
  private attempts: number[] = [];
  reserve(now: number, interval: number, maximum: number) {
    this.attempts = this.attempts.filter(time => time > now - DAY_MS);
    const latest = this.attempts.at(-1);
    if (latest !== undefined && latest + interval > now) return latest + interval;
    if (this.attempts.length >= maximum) return this.attempts[0] + DAY_MS;
    this.attempts.push(now);
    return 0;
  }
}
const local = new LocalYouTubeAdmission();

export async function reserveYouTubeRefresh() {
  const interval = positiveInteger(process.env.YOUTUBE_REFRESH_INTERVAL_MS, 1200000);
  const maximum = positiveInteger(process.env.YOUTUBE_MAX_REFRESHES_PER_DAY, 90);
  let retryAt: number;
  if (process.env.REDIS_URL) {
    try {
      const redis = await getRedisClient();
      retryAt = Number(await redis.eval(RESERVE_YOUTUBE, 1, KEY, interval, maximum, randomUUID()));
      if (!Number.isFinite(retryAt) || retryAt < 0) throw new Error('Invalid quota admission response');
    } catch (error) {
      Sentry.captureException(error);
      // Shared admission is mandatory when configured: an outage cannot bypass it.
      throw new RefreshDeferredError(Date.now() + 15000);
    }
  } else if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new RefreshDeferredError(Date.now() + 15000);
  } else retryAt = local.reserve(Date.now(), interval, maximum);
  if (retryAt) throw new RefreshDeferredError(retryAt);
}
