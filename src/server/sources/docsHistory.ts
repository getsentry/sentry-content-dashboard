import { unstable_cache } from 'next/cache';
import { normalizeContent } from '../../utils/content';

// Recover real documentation changes without depending on the webhook writer or
// its Redis store. Cache across workers to bound GitHub requests during an outage.
export const loadDocsHistory = unstable_cache(async () => {
  const groups = await Promise.all(['docs', 'platform-includes'].map(async path => {
    const query = new URLSearchParams({ path, per_page: '30', sha: 'master' });
    const response = await fetch(`https://api.github.com/repos/getsentry/sentry-docs/commits?${query}`, {
      headers: { Accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`GitHub docs history request failed (${response.status})`);
    const commits = await response.json();
    if (!Array.isArray(commits)) throw new Error('Invalid GitHub docs history');
    return normalizeContent(commits.map(commit => ({
      id: `docs-${commit.sha}`,
      commitId: commit.sha,
      title: `Docs Update: ${commit.commit.message.split('\n')[0]}`,
      description: commit.commit.message.split('\n')[0],
      url: commit.html_url,
      publishedAt: [commit.commit.author?.date, commit.commit.committer?.date].find(date =>
        typeof date === 'string' && Number.isFinite(Date.parse(date))),
      author: commit.commit.author?.name,
      categories: ['technical', 'documentation'],
    })), 'docs');
  }));
  return [...new Map(groups.flat().map(item => [item.id, item])).values()];
}, ['docs-github-history-v1'], { revalidate: 300 });
