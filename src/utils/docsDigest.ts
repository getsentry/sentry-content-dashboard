import type { ChangelogEntry } from './changelogStorage';
import type { DigestCommit } from './content';

export type { DigestCommit };
export interface DigestEntry extends ChangelogEntry {
  commits: DigestCommit[];
}

const REPO_URL = 'https://github.com/getsentry/sentry-docs';

// A commit belongs to the UTC day it was merged into master, not the day its
// branch work began. Authoring dates can precede the merge by weeks.
export function digestDay(mergedAt: string): string {
  const day = new Date(mergedAt);
  if (!Number.isFinite(day.getTime())) throw new Error('Invalid digest timestamp');
  return day.toISOString().slice(0, 10);
}

export function digestId(day: string): string {
  return `docs-digest-${day}`;
}

export function isDigest(entry: { id?: unknown; commits?: unknown }): entry is DigestEntry {
  return typeof entry.id === 'string' && entry.id.startsWith('docs-digest-') && Array.isArray(entry.commits);
}

// True once a commit is stored, whether as a digest member or a legacy per-commit
// entry, so redelivered webhooks skip the GitHub and OpenAI calls.
export function containsCommit(entries: ChangelogEntry[], sha: string): boolean {
  return entries.some(entry => entry.id === `docs-${sha}` ||
    (isDigest(entry) && entry.commits.some(commit => commit.id === sha)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
});

export function buildDigest(day: string, commits: DigestCommit[]): DigestEntry {
  if (!commits.length) throw new Error('A digest needs at least one commit');
  // Newest first so the card leads with the most recent change of the day.
  const ordered = [...commits].sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
  const authors = unique(ordered.map(commit => commit.author).filter(Boolean));
  // The full text stays in `description` so search still matches every summary;
  // the card renders `commits` as a list rather than this joined string.
  const summary = ordered.map(commit => commit.summary).filter(Boolean).join(' • ');
  return {
    id: digestId(day),
    title: `Docs Updates — ${DAY_LABEL.format(new Date(`${day}T00:00:00Z`))} (${ordered.length} ${ordered.length === 1 ? 'change' : 'changes'})`,
    description: summary,
    url: `${REPO_URL}/commits/master?since=${day}&until=${day}`,
    publishedAt: ordered[0].mergedAt,
    source: 'changelog',
    categories: ['technical', 'documentation'],
    commitId: ordered[0].id,
    author: authors.length === 1 ? authors[0] : `${authors.length} contributors`,
    filesChanged: {
      added: unique(ordered.flatMap(commit => commit.filesChanged.added)),
      modified: unique(ordered.flatMap(commit => commit.filesChanged.modified)),
      removed: unique(ordered.flatMap(commit => commit.filesChanged.removed)),
    },
    aiSummary: summary,
    commits: ordered,
  };
}

// Upsert one commit into its day's digest. Pure and idempotent so the caller can
// re-run it inside a compare-and-set retry against freshly read history.
export function mergeDigestCommit(entries: ChangelogEntry[], commit: DigestCommit): ChangelogEntry[] {
  const day = digestDay(commit.mergedAt);
  const id = digestId(day);
  const existing = entries.find(entry => entry.id === id);
  const previous = existing && isDigest(existing) ? existing.commits : [];
  // Redelivery must replace, never duplicate.
  const commits = [...previous.filter(member => member.id !== commit.id), commit];
  // Absorb any legacy per-commit entries the digest now covers.
  const superseded = new Set(commits.map(member => `docs-${member.id}`));
  return [
    ...entries.filter(entry => entry.id !== id && !superseded.has(entry.id)),
    buildDigest(day, commits),
  ];
}
