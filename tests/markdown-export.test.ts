import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildDigest } from '../src/utils/docsDigest';
import type { DigestCommit } from '../src/utils/content';

const docs = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../src/server/sources/docs', () => ({ load: async () => ({ items: docs.items }) }));
vi.mock('../config', () => ({ config: { youtube: { apiKey: '', channelId: 'test', maxResults: 50 }, content: { daysToShow: 90 } } }));
import { GET as markdown } from '../src/app/api/export/markdown/route';

const commit = (id: string, overrides: Partial<DigestCommit> = {}): DigestCommit => ({
  id, title: `docs(js): change ${id}`, summary: `summary ${id}`, author: `Author ${id}`,
  url: `https://github.com/getsentry/sentry-docs/commit/${id}`, mergedAt: '2026-09-22T05:00:00Z',
  filesChanged: { added: [], modified: [`docs/${id}.mdx`], removed: [] }, ...overrides,
});

beforeEach(() => {
  docs.items = [];
  vi.stubEnv('REDIS_URL', ''); vi.stubEnv('VERCEL', ''); vi.stubEnv('NODE_ENV', 'test');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<rss><channel/></rss>')));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test('a digest exports its commits rather than one joined description line', async () => {
  docs.items = [buildDigest('2026-09-22', [commit('aaa'), commit('bbb')])];
  const exported = await (await markdown()).text();
  expect(exported).toContain('- **Changes** (2):');
  expect(exported).toContain('docs\\(js\\): change aaa');
  expect(exported).toContain('https://github\\.com/getsentry/sentry\\-docs/commit/bbb');
  expect(exported).toContain('**Author**: Author aaa');
  expect(exported).toContain('**Summary**: summary bbb');
  // The joined blob is what this replaces; it must not also be emitted.
  expect(exported).not.toContain('**Description**: summary aaa');
});

test('a legacy entry without commits still exports its description', async () => {
  docs.items = [{
    id: 'docs-legacy', title: 'Docs Update: old entry', description: 'a legacy summary',
    url: 'https://github.com/getsentry/sentry-docs/commit/legacy', publishedAt: '2026-09-20T00:00:00Z',
  }];
  const exported = await (await markdown()).text();
  expect(exported).toContain('**Description**: a legacy summary');
  expect(exported).not.toContain('**Changes**');
});
