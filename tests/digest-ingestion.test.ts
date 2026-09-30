import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveDigestCommit, getChangelogEntries } from '../src/utils/changelogStorage';
import { load } from '../src/server/sources/docs';
import { normalizeContent } from '../src/utils/content';
import type { DigestCommit } from '../src/utils/content';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'digest-e2e-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.stubEnv('REDIS_URL', ''); vi.stubEnv('VERCEL', '');
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

const commit = (id: string, mergedAt: string): DigestCommit => ({
  id, title: `docs(js): change ${id}`, summary: `summary ${id}`, author: 'Author',
  url: `https://github.com/getsentry/sentry-docs/commit/${id}`, mergedAt,
  filesChanged: { added: [], modified: [`docs/${id}.mdx`], removed: [] },
});

test('end to end: concurrent ingests produce one digest per day that survives the docs source', async () => {
  // Nine commits across two merge days, written concurrently as webhooks would.
  await Promise.all([
    ...Array.from({ length: 6 }, (_, i) => saveDigestCommit(commit(`a${i}`, `2026-09-22T0${i}:00:00Z`))),
    ...Array.from({ length: 3 }, (_, i) => saveDigestCommit(commit(`b${i}`, `2026-09-21T0${i}:00:00Z`))),
  ]);
  const stored = await getChangelogEntries();
  expect(stored).toHaveLength(2);

  const items = normalizeContent((await load()).items, 'docs');
  expect(items).toHaveLength(2);
  const [newest, older] = items;
  expect(newest.id).toBe('docs-digest-2026-09-22');
  expect(newest.commits).toHaveLength(6);
  expect(newest.title).toContain('(6 changes)');
  expect(older.id).toBe('docs-digest-2026-09-21');
  expect(older.commits).toHaveLength(3);
  // normalizeContent must not strip the digest payload the card renders.
  expect(newest.commits?.[0].url).toContain('/commit/a5');
  expect(new Date(newest.publishedAt).toISOString()).toBe('2026-09-22T05:00:00.000Z');
});
