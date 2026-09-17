import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm as realRm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const failures = vi.hoisted(() => ({ temporary: false, rename: false, lock: false }));
vi.mock('fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, rename: vi.fn(async (...args: Parameters<typeof fs.rename>) => {
    if (failures.rename) throw new Error('primary rename failure');
    return fs.rename(...args);
  }), rm: vi.fn(async (...args: Parameters<typeof fs.rm>) => {
    if (failures.temporary && String(args[0]).endsWith('.tmp')) throw new Error('temporary cleanup failure');
    if (failures.lock && String(args[0]).endsWith('.lock')) throw new Error('lock cleanup failure');
    return fs.rm(...args);
  }) };
});
import { rm } from 'fs/promises';
import { saveChangelogEntry, type ChangelogEntry } from '../src/utils/changelogStorage';
let directory: string;
const entry = { id: 'one', publishedAt: '2026-09-17' } as ChangelogEntry;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cleanup-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.stubEnv('REDIS_URL', ''); vi.stubEnv('VERCEL', '');
  Object.assign(failures, { temporary: false, rename: false, lock: false });
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  Object.assign(failures, { temporary: false, rename: false, lock: false });
  await realRm(directory, { recursive: true, force: true });
});
test('temporary cleanup failure still releases lock and allows the next writer', async () => {
  failures.temporary = true;
  await expect(saveChangelogEntry(entry)).rejects.toThrow('Changelog cleanup failed');
  expect(rm).toHaveBeenCalledWith(path.join(directory, 'data/docs-changelog.json.lock'), { recursive: true });
  failures.temporary = false;
  await saveChangelogEntry({ ...entry, id: 'two' });
  expect(JSON.parse(await readFile(path.join(directory, 'data/docs-changelog.json'), 'utf8'))).toHaveLength(2);
});
test('cleanup errors do not mask the original write failure', async () => {
  failures.rename = failures.temporary = failures.lock = true;
  await expect(saveChangelogEntry(entry)).rejects.toThrow('primary rename failure');
  expect(rm).toHaveBeenCalledTimes(2);
});
