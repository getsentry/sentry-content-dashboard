import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), getCommit: vi.fn(), getGitCommit: vi.fn() }));
vi.mock('../src/utils/changelogStorage', () => ({ getChangelogEntries: mocks.read, saveDigestCommit: mocks.save }));
vi.mock('@octokit/rest', () => ({ Octokit: class { rest = { repos: { getCommit: mocks.getCommit }, git: { getCommit: mocks.getGitCommit } }; } }));
import { processDocsChanges } from '../src/utils/githubProcessor';
beforeEach(() => vi.resetAllMocks());
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

function commitResponse(author: unknown, committer: unknown, files = [{ filename: 'docs/test.md', status: 'modified' }]) {
  return { data: { sha: 'abc', commit: { message: 'Update docs', author, committer }, html_url: 'https://github.com/getsentry/sentry-docs/commit/abc', files } };
}
test('nullable repository dates recover the merge date from canonical Git metadata', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test'); vi.stubEnv('OPENAI_API_KEY', '');
  mocks.read.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined);
  mocks.getCommit.mockResolvedValue(commitResponse(null, null));
  mocks.getGitCommit.mockResolvedValue({ data: { sha: 'abc', author: { date: '2025-10-07T12:00:00Z' }, committer: { date: '2025-10-08T12:00:00Z' } } });
  expect(await processDocsChanges({ id: 'abc' })).toBe(true);
  expect(mocks.getGitCommit).toHaveBeenCalledExactlyOnceWith({ owner: 'getsentry', repo: 'sentry-docs', commit_sha: 'abc' });
  // The committer date is when the work merged; authoring predates it.
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ mergedAt: '2025-10-08T12:00:00Z' }));
});
test('a commit authored before it merged is filed under its merge date', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test'); vi.stubEnv('OPENAI_API_KEY', '');
  mocks.read.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined);
  mocks.getCommit.mockResolvedValue(commitResponse({ date: '2025-10-01T09:00:00Z' }, { date: '2025-10-08T12:00:00Z' }));
  expect(await processDocsChanges({ id: 'abc' })).toBe(true);
  expect(mocks.getGitCommit).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ mergedAt: '2025-10-08T12:00:00Z' }));
});
test('invalid committer date falls back to the author date without another API call', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test'); vi.stubEnv('OPENAI_API_KEY', '');
  mocks.read.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined);
  mocks.getCommit.mockResolvedValue(commitResponse({ date: '2025-10-08T12:00:00Z' }, { date: 'invalid' }));
  expect(await processDocsChanges({ id: 'abc' })).toBe(true);
  expect(mocks.getGitCommit).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ mergedAt: '2025-10-08T12:00:00Z' }));
});
test('a commit already inside a digest skips the GitHub and summary work', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test');
  mocks.read.mockResolvedValue([{ id: 'docs-digest-2025-10-08', commits: [{ id: 'abc' }] }]);
  expect(await processDocsChanges({ id: 'abc' })).toBe(true);
  expect(mocks.getCommit).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
test('truly missing canonical dates or mismatched objects fail without writing misleading data', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test'); mocks.read.mockResolvedValue([]);
  mocks.getCommit.mockResolvedValue(commitResponse(null, null));
  mocks.getGitCommit.mockResolvedValueOnce({ data: { sha: 'abc', author: null, committer: null } });
  await expect(processDocsChanges({ id: 'abc' })).rejects.toThrow('no valid canonical timestamp');
  mocks.getGitCommit.mockResolvedValueOnce({ data: { sha: 'other', author: { date: '2025-10-07' } } });
  await expect(processDocsChanges({ id: 'abc' })).rejects.toThrow('SHA mismatch');
  expect(mocks.save).not.toHaveBeenCalled();
});
test('non-documentation commits do not require date recovery', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'test'); mocks.read.mockResolvedValue([]);
  mocks.getCommit.mockResolvedValue(commitResponse(null, null, [{ filename: 'package.json', status: 'modified' }]));
  expect(await processDocsChanges({ id: 'abc' })).toBe(false);
  expect(mocks.getGitCommit).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
