import * as Sentry from '@sentry/nextjs';
import { readFile, mkdir, rename, writeFile, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import type Redis from 'ioredis';

export interface ChangelogEntry {
  aiSummary: string;
  author: string;
  categories: string[];
  commitId: string;
  description: string;
  filesChanged: { added: string[]; modified: string[]; removed: string[] };
  id: string;
  publishedAt: string;
  source: 'changelog' | 'docs';
  title: string;
  url: string;
}

const KV_KEY = 'docs-changelog';
const changelogFile = () => path.join(process.cwd(), 'data', 'docs-changelog.json');
let redisConnection: Promise<Redis> | undefined;

function usesRedis() {
  if (process.env.REDIS_URL) return true;
  if (process.env.VERCEL) throw new Error('REDIS_URL is required on Vercel');
  return false;
}

export async function getRedisClient(): Promise<Redis> {
  if (!redisConnection) {
    redisConnection = (async () => {
      const { default: RedisClient } = await import('ioredis');
      const client = new RedisClient(process.env.REDIS_URL!, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        connectTimeout: 10000,
      });
      client.on('error', () => { /* Errors are handled by the awaited operation. */ });
      try {
        await client.connect();
        return client;
      } catch (error) {
        client.disconnect();
        throw error;
      }
    })().catch(error => {
      redisConnection = undefined;
      throw error;
    });
  }
  return redisConnection;
}

function parseEntries(data: string): ChangelogEntry[] {
  const entries: unknown = JSON.parse(data);
  if (!Array.isArray(entries) || entries.some(entry =>
    !entry || typeof entry.id !== 'string' || typeof entry.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(entry.publishedAt)))) {
    throw new Error('Invalid changelog storage');
  }
  return entries;
}

async function readLocalEntries(): Promise<ChangelogEntry[]> {
  try {
    return parseEntries(await readFile(changelogFile(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

// Compare-and-set preserves the existing JSON key and retries competing writers.
const COMPARE_AND_SET = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

function mergeEntry(entries: ChangelogEntry[], entry: ChangelogEntry) {
  return [...entries.filter(old => old.id !== entry.id), entry]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 100);
}

export async function saveChangelogEntry(entry: ChangelogEntry): Promise<void> {
  // Reject invalid timestamps before attempting any write.
  entry = { ...entry, publishedAt: new Date(entry.publishedAt).toISOString() };
  if (usesRedis()) {
    const redis = await getRedisClient();
    for (let attempt = 0; attempt < 30; attempt++) {
      const raw = await redis.get(KV_KEY);
      const updated = mergeEntry(raw === null ? [] : parseEntries(raw), entry);
      if (await redis.eval(COMPARE_AND_SET, 1, KV_KEY, raw ?? '', JSON.stringify(updated)) === 1) return;
    }
    throw new Error('Changelog write contention; retry delivery');
  }

  const file = changelogFile();
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 10000;
  // mkdir is exclusive across processes; never steal a possibly live writer's lock.
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Changelog storage is locked; retry after the writer finishes');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const entries = await readLocalEntries();
    const updated = mergeEntry(entries, entry);
    await writeFile(temporary, JSON.stringify(updated, null, 2));
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true });
  }
}

export async function getChangelogEntries(): Promise<ChangelogEntry[]> {
  try {
    if (usesRedis()) {
      const raw = await (await getRedisClient()).get(KV_KEY);
      return raw === null ? [] : parseEntries(raw);
    }
    return await readLocalEntries();
  } catch (error) {
    Sentry.captureException(error);
    Sentry.logger.error('Documentation changelog storage read failed');
    throw error;
  }
}
