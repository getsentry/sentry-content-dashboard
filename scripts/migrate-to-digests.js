/**
 * One-time backfill: fold legacy per-commit docs entries into daily digests.
 *
 * Going forward the webhook writes digests directly, and a digest absorbs any
 * legacy entries for a day it receives a new commit for. Past days never get a
 * new commit, so this script converts the existing backlog in one pass.
 *
 * Buckets by each entry's stored publishedAt. Entries written before this change
 * stored the AUTHOR date, so a commit authored and merged on different days can
 * land a day early. Re-deriving true merge dates would need a GitHub call per
 * commit; the backlog ages out of the 100-entry cap within about two weeks.
 *
 * Mirrors the conventions in src/utils/docsDigest.ts -- keep them in step.
 *
 * Usage:
 *   REDIS_URL='rediss://...' node scripts/migrate-to-digests.js           # dry run
 *   REDIS_URL='rediss://...' node scripts/migrate-to-digests.js --apply   # write
 */

const KV_KEY = 'docs-changelog';
const MAX_ENTRIES = 100;
const REPO_URL = 'https://github.com/getsentry/sentry-docs';
const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
});

const url = process.env.REDIS_URL;
const apply = process.argv.includes('--apply');
if (!url) {
  console.error('Set REDIS_URL to the store holding the changelog.');
  process.exit(1);
}

const isLegacy = entry => typeof entry.id === 'string' &&
  entry.id.startsWith('docs-') && !entry.id.startsWith('docs-digest-');
const unique = values => [...new Set(values)].sort();
const files = entry => ({
  added: entry.filesChanged?.added ?? [],
  modified: entry.filesChanged?.modified ?? [],
  removed: entry.filesChanged?.removed ?? [],
});

function buildDigest(day, commits) {
  const ordered = [...commits].sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
  const authors = unique(ordered.map(c => c.author).filter(Boolean));
  const summary = ordered.map(c => c.summary).filter(Boolean).join(' • ');
  return {
    id: `docs-digest-${day}`,
    title: `Docs Updates — ${DAY_LABEL.format(new Date(`${day}T00:00:00Z`))} (${ordered.length} ${ordered.length === 1 ? 'change' : 'changes'})`,
    description: summary,
    url: `${REPO_URL}/commits/master?since=${day}&until=${day}`,
    publishedAt: ordered[0].mergedAt,
    source: 'changelog',
    categories: ['technical', 'documentation'],
    commitId: ordered[0].id,
    author: authors.length === 1 ? authors[0] : `${authors.length} contributors`,
    filesChanged: {
      added: unique(ordered.flatMap(c => c.filesChanged.added)),
      modified: unique(ordered.flatMap(c => c.filesChanged.modified)),
      removed: unique(ordered.flatMap(c => c.filesChanged.removed)),
    },
    aiSummary: summary,
    commits: ordered,
  };
}

(async () => {
  const Redis = require('ioredis');
  const redis = new Redis(url, {
    tls: url.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: 3,
    connectTimeout: 15000,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    const raw = await redis.get(KV_KEY);
    if (raw === null) {
      console.log(`Key "${KV_KEY}" does not exist. Nothing to migrate.`);
      return;
    }
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error('Stored changelog is not an array');

    const legacy = entries.filter(isLegacy);
    const keep = entries.filter(entry => !isLegacy(entry));
    console.log(`Read ${entries.length} entries: ${legacy.length} legacy, ${keep.length} already migrated or unrelated.`);
    if (!legacy.length) {
      console.log('Nothing to migrate.');
      return;
    }

    // Seed the buckets with any existing digests so a day is never split in two.
    const days = new Map();
    for (const entry of keep) {
      if (entry.id?.startsWith('docs-digest-') && Array.isArray(entry.commits)) {
        days.set(entry.id.slice('docs-digest-'.length), [...entry.commits]);
      }
    }
    let skipped = 0;
    for (const entry of legacy) {
      const at = new Date(entry.publishedAt);
      if (!Number.isFinite(at.getTime())) { skipped++; continue; }
      const day = at.toISOString().slice(0, 10);
      const commits = days.get(day) ?? [];
      const id = entry.commitId || entry.id.slice('docs-'.length);
      if (!commits.some(member => member.id === id)) {
        commits.push({
          id,
          title: String(entry.title ?? '').replace(/^Docs Update:\s*/, '') || id,
          summary: entry.aiSummary || entry.description || '',
          author: entry.author || '',
          url: entry.url || `${REPO_URL}/commit/${id}`,
          mergedAt: at.toISOString(),
          filesChanged: files(entry),
        });
      }
      days.set(day, commits);
    }
    if (skipped) console.warn(`Skipped ${skipped} legacy entries with an unusable date.`);

    const rebuilt = [...keep.filter(entry => !entry.id?.startsWith('docs-digest-'))];
    for (const [day, commits] of days) rebuilt.push(buildDigest(day, commits));
    const updated = rebuilt
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, MAX_ENTRIES);

    console.log(`\n${entries.length} entries -> ${updated.length} (${days.size} digest days):`);
    for (const entry of updated.filter(e => e.id.startsWith('docs-digest-'))) {
      console.log(`  ${entry.id}  ${entry.commits.length} commits`);
    }

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to write this back.');
      return;
    }
    // Compare-and-set against the exact bytes read, so a concurrent webhook
    // write is never silently discarded.
    const swapped = await redis.eval(
      "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[2]) return 1",
      1, KV_KEY, raw, JSON.stringify(updated),
    );
    if (swapped !== 1) {
      console.error('\nThe changelog changed while migrating. Nothing written -- re-run.');
      process.exitCode = 1;
      return;
    }
    console.log('\nMigrated.');
  } catch (error) {
    console.error('\nFailed:', error.message);
    process.exitCode = 1;
  } finally {
    await redis.quit().catch(() => {});
  }
})();
