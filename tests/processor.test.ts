import { afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), getCommit: vi.fn() }));
vi.mock('../src/utils/changelogStorage', () => ({ getChangelogEntries: mocks.read, saveChangelogEntry: mocks.save }));
vi.mock('@octokit/rest', () => ({ Octokit: class { rest = { repos: { getCommit: mocks.getCommit } }; } }));
import { processDocsChanges } from '../src/utils/githubProcessor';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
test('processor propagates storage failure and never reports successful ingestion', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test'); vi.stubEnv('OPENAI_API_KEY', '');
  mocks.read.mockResolvedValue([]);
  mocks.getCommit.mockResolvedValue({ data: { sha: 'abc', commit: { message: 'Update docs', author: { name: 'Author', date: '2026-09-16' } }, html_url: 'https://github.com/getsentry/sentry-docs/commit/abc', files: [{ filename: 'docs/test.md', status: 'modified' }] } });
  mocks.save.mockRejectedValue(Error('Redis unavailable'));
  await expect(processDocsChanges({ id: 'abc' })).rejects.toThrow('Redis unavailable');
});
test('already stored commits avoid duplicate summary and storage work', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test'); mocks.read.mockResolvedValue([{ id: 'docs-abc' }]);
  expect(await processDocsChanges({ id: 'abc' })).toBe(true);
  expect(mocks.getCommit).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
