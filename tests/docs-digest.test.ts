import { expect, test } from 'vitest';
import { buildDigest, containsCommit, digestDay, digestId, isDigest, mergeDigestCommit } from '../src/utils/docsDigest';
import type { DigestCommit } from '../src/utils/content';
import type { ChangelogEntry } from '../src/utils/changelogStorage';

const commit = (id: string, mergedAt: string, overrides: Partial<DigestCommit> = {}): DigestCommit => ({
  id, title: `commit ${id}`, summary: `summary ${id}`, author: 'Author',
  url: `https://github.com/getsentry/sentry-docs/commit/${id}`, mergedAt,
  filesChanged: { added: [], modified: [`docs/${id}.mdx`], removed: [] }, ...overrides,
});
const legacy = (id: string, publishedAt: string) => ({ id, publishedAt } as ChangelogEntry);
const digestFor = (entries: ChangelogEntry[], day: string) => {
  const found = entries.find(entry => entry.id === digestId(day));
  if (!found || !isDigest(found)) throw new Error(`no digest for ${day}`);
  return found;
};

test('commits merged on the same day collapse into a single entry', () => {
  let entries: ChangelogEntry[] = [];
  entries = mergeDigestCommit(entries, commit('a', '2026-09-22T01:00:00Z'));
  entries = mergeDigestCommit(entries, commit('b', '2026-09-22T13:00:00Z'));
  expect(entries).toHaveLength(1);
  const digest = digestFor(entries, '2026-09-22');
  expect(digest.commits.map(member => member.id)).toEqual(['b', 'a']);
  // The digest sorts to the position of its most recent commit.
  expect(digest.publishedAt).toBe('2026-09-22T13:00:00Z');
  expect(digest.title).toBe('Docs Updates — September 22, 2026 (2 changes)');
});

test('redelivering a commit updates it in place instead of duplicating it', () => {
  let entries = mergeDigestCommit([], commit('a', '2026-09-22T01:00:00Z'));
  entries = mergeDigestCommit(entries, commit('a', '2026-09-22T01:00:00Z', { summary: 'corrected' }));
  const digest = digestFor(entries, '2026-09-22');
  expect(digest.commits).toHaveLength(1);
  expect(digest.commits[0].summary).toBe('corrected');
  expect(digest.title).toContain('(1 change)');
});

test('separate merge days stay separate digests', () => {
  let entries = mergeDigestCommit([], commit('a', '2026-09-21T23:00:00Z'));
  entries = mergeDigestCommit(entries, commit('b', '2026-09-22T00:30:00Z'));
  expect(entries.map(entry => entry.id).sort())
    .toEqual(['docs-digest-2026-09-21', 'docs-digest-2026-09-22']);
});

test('the merge day is the UTC day, not the local day of the offset', () => {
  // 23:00 on the 16th at -07:00 is 06:00 UTC on the 17th.
  expect(digestDay('2026-09-16T23:00:00-07:00')).toBe('2026-09-17');
  const digest = digestFor(mergeDigestCommit([], commit('a', '2026-09-16T23:00:00-07:00')), '2026-09-17');
  expect(digest.commits).toHaveLength(1);
});

test('legacy per-commit entries are absorbed by the digest that now covers them', () => {
  const entries = mergeDigestCommit(
    [legacy('docs-a', '2026-09-22T01:00:00Z'), legacy('docs-unrelated', '2026-09-20T01:00:00Z')],
    commit('a', '2026-09-22T01:00:00Z'),
  );
  expect(entries.map(entry => entry.id).sort())
    .toEqual(['docs-digest-2026-09-22', 'docs-unrelated']);
});

test('a digest unions its files and counts its distinct authors', () => {
  const digest = buildDigest('2026-09-22', [
    commit('a', '2026-09-22T01:00:00Z', { author: 'Ada', filesChanged: { added: ['docs/new.mdx'], modified: ['docs/shared.mdx'], removed: [] } }),
    commit('b', '2026-09-22T02:00:00Z', { author: 'Grace', filesChanged: { added: [], modified: ['docs/shared.mdx'], removed: ['docs/old.mdx'] } }),
  ]);
  expect(digest.filesChanged).toEqual({ added: ['docs/new.mdx'], modified: ['docs/shared.mdx'], removed: ['docs/old.mdx'] });
  expect(digest.author).toBe('2 contributors');
  // Every summary stays in the description so search still matches all of them.
  expect(digest.description).toBe('summary b • summary a');
});

test('a single-author digest names that author', () => {
  expect(buildDigest('2026-09-22', [commit('a', '2026-09-22T01:00:00Z', { author: 'Ada' })]).author).toBe('Ada');
});

test('stored commits are recognised in both digest and legacy form', () => {
  const entries = mergeDigestCommit([legacy('docs-old', '2026-09-01T00:00:00Z')], commit('a', '2026-09-22T01:00:00Z'));
  expect(containsCommit(entries, 'a')).toBe(true);
  expect(containsCommit(entries, 'old')).toBe(true);
  expect(containsCommit(entries, 'missing')).toBe(false);
});

test('an unusable merge timestamp is rejected rather than bucketed as today', () => {
  expect(() => digestDay('not-a-date')).toThrow('Invalid digest timestamp');
  expect(() => mergeDigestCommit([], commit('a', 'not-a-date'))).toThrow('Invalid digest timestamp');
});
