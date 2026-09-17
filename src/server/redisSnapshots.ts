import { randomUUID } from 'crypto';
import { getRedisClient } from '../utils/changelogStorage';
import { normalizeContent, type ContentSource, type SourceSnapshot } from '../utils/content';
import type { SnapshotStore } from './sourceCache';

const key = (source: ContentSource) => `content:v1:${source}`;
const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
const SAVE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', 86400)
redis.call('DEL', KEYS[1])
return 1`;

export const redisSnapshots: SnapshotStore = {
  async read(source) {
    const raw = await (await getRedisClient()).get(key(source));
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.fetchedAt)) throw new Error('Invalid content snapshot timestamp');
    return { ...value, items: normalizeContent(value.items, source) };
  },
  async refresh(source, previous, load) {
    const redis = await getRedisClient();
    const lock = `${key(source)}:lock`;
    const token = randomUUID();
    const deadline = Date.now() + 18000;
    for (;;) {
      const current = await this.read(source);
      if (current && current.fetchedAt > (previous?.fetchedAt || 0)) return current;
      if (await redis.set(lock, token, 'PX', 18000, 'NX')) break;
      if (Date.now() >= deadline) throw new Error('Content refresh busy; retry shortly');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    try {
      const snapshot: SourceSnapshot = await load();
      if (await redis.eval(SAVE, 2, lock, key(source), token, JSON.stringify(snapshot)) !== 1) {
        throw new Error('Content refresh lease expired');
      }
      return snapshot;
    } finally {
      await redis.eval(UNLOCK, 1, lock, token);
    }
  },
};
