import * as Sentry from '@sentry/nextjs';
import { readFile, mkdir, rename, writeFile, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import { getRedisClient, usesRedis } from './changelogStorage';

export interface CustomerStory {
  url: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail?: string;
  source: 'customers';
}
export interface CustomerStoryState {
  // Story URLs already accounted for, whether displayed or only baselined.
  knownUrls: string[];
  stories: CustomerStory[];
  lastPolledAt: number;
}

const KV_KEY = 'customer-stories';
const MAX_STORED_STORIES = 100;
const stateFile = () => path.join(process.cwd(), 'data', 'customer-stories-state.json');
const baselineFile = () => path.join(process.cwd(), 'data', 'customer-stories.json');

const EMPTY: CustomerStoryState = { knownUrls: [], stories: [], lastPolledAt: 0 };

function parseState(data: string): CustomerStoryState {
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object') throw new Error('Invalid customer story state');
  const { knownUrls, stories, lastPolledAt } = value as Partial<CustomerStoryState>;
  if (!Array.isArray(knownUrls) || knownUrls.some(url => typeof url !== 'string')) {
    throw new Error('Invalid customer story state');
  }
  if (!Array.isArray(stories) || stories.some(story =>
    !story || typeof story.url !== 'string' || typeof story.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(story.publishedAt)))) {
    throw new Error('Invalid customer story state');
  }
  return { knownUrls, stories, lastPolledAt: Number.isFinite(lastPolledAt) ? lastPolledAt! : 0 };
}

// The committed baseline is the floor: the catalogue that existed when this
// source was added, which must never resurface as newly discovered even if the
// runtime state is lost. Only stories appearing after it are ever displayed.
let baseline: Promise<string[]> | undefined;
export function readBaselineUrls(): Promise<string[]> {
  return baseline ??= (async () => {
    try {
      const data = JSON.parse(await readFile(baselineFile(), 'utf8'));
      if (!Array.isArray(data.baselineUrls) || data.baselineUrls.some((url: unknown) => typeof url !== 'string')) {
        throw new Error('Invalid customer story baseline');
      }
      return data.baselineUrls as string[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  })().catch(error => { baseline = undefined; throw error; });
}

async function readRaw(): Promise<{ raw: string | null; state: CustomerStoryState }> {
  if (usesRedis()) {
    const raw = await (await getRedisClient()).get(KV_KEY);
    return { raw, state: raw === null ? { ...EMPTY } : parseState(raw) };
  }
  try {
    const raw = await readFile(stateFile(), 'utf8');
    return { raw, state: parseState(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { raw: null, state: { ...EMPTY } };
    throw error;
  }
}

export async function getCustomerStoryState(): Promise<CustomerStoryState> {
  const [{ state }, floor] = await Promise.all([readRaw(), readBaselineUrls()]);
  return { ...state, knownUrls: [...new Set([...floor, ...state.knownUrls])] };
}

// Compare-and-set preserves a competing writer's work rather than clobbering it.
const COMPARE_AND_SET = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

function merge(current: CustomerStoryState, update: CustomerStoryState): CustomerStoryState {
  const stories = [...current.stories.filter(old => !update.stories.some(one => one.url === old.url)), ...update.stories]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_STORED_STORIES);
  return {
    knownUrls: [...new Set([...current.knownUrls, ...update.knownUrls])],
    stories,
    lastPolledAt: Math.max(current.lastPolledAt, update.lastPolledAt),
  };
}

export async function saveCustomerStoryState(update: CustomerStoryState): Promise<void> {
  if (usesRedis()) {
    const redis = await getRedisClient();
    for (let attempt = 0; attempt < 30; attempt++) {
      const raw = await redis.get(KV_KEY);
      const merged = merge(raw === null ? { ...EMPTY } : parseState(raw), update);
      if (await redis.eval(COMPARE_AND_SET, 1, KV_KEY, raw ?? '', JSON.stringify(merged)) === 1) return;
    }
    throw new Error('Customer story write contention; retry later');
  }

  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 10000;
  // mkdir is exclusive across processes; never steal a possibly live writer's lock.
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Customer story storage is locked; retry after the writer finishes');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  let writeFailed = false;
  try {
    const { state } = await readRaw();
    await writeFile(temporary, JSON.stringify(merge(state, update), null, 2));
    await rename(temporary, file);
  } catch (error) {
    writeFailed = true;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([rm(temporary, { force: true }), rm(lock, { recursive: true })]);
    const errors = cleanup.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    errors.forEach(error => Sentry.captureException(error));
    if (errors.length && !writeFailed) throw new AggregateError(errors, 'Customer story cleanup failed');
  }
}

// Tests reset the memoised baseline between temporary working directories.
export function resetBaselineCache() { baseline = undefined; }
