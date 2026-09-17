import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getChangelogEntries, saveChangelogEntry, type ChangelogEntry } from '../src/utils/changelogStorage';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'content-storage-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.stubEnv('REDIS_URL', ''); vi.stubEnv('VERCEL', '');
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
function entry(id: string): ChangelogEntry { return { id, title: id, publishedAt: '2026-09-16', url: 'https://example.com', source: 'docs', categories: [], description: '', author: '', commitId: id, aiSummary: '', filesChanged: { added: [], removed: [], modified: [] } }; }
test('simultaneous writers preserve every entry and deduplicate retries', async () => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => saveChangelogEntry(entry(String(i)))));
  await saveChangelogEntry(entry('0'));
  expect(await getChangelogEntries()).toHaveLength(12);
});
test('corrupt history fails closed and cannot be overwritten', async () => {
  await mkdir(path.join(directory, 'data'));
  const file = path.join(directory, 'data/docs-changelog.json');
  await writeFile(file, '{broken');
  await expect(getChangelogEntries()).rejects.toThrow();
  await expect(saveChangelogEntry(entry('new'))).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe('{broken');
});
test('missing history is empty but inaccessible storage is an error', async () => {
  expect(await getChangelogEntries()).toEqual([]);
  await mkdir(path.join(directory, 'data/docs-changelog.json'), { recursive: true });
  await expect(getChangelogEntries()).rejects.toThrow();
});
