import * as Sentry from '@sentry/nextjs';
import { readFile } from 'fs/promises';
import path from 'path';
import { getChangelogEntries } from '../../utils/changelogStorage';
import { normalizeContent } from '../../utils/content';
import { loadDocsHistory } from './docsHistory';

export async function load() {
  const [staticDocs, changelog] = await Promise.all([fetchStaticDocs(), readChangelog()]);
  const items = normalizeContent([...staticDocs, ...changelog], 'docs')
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  Sentry.logger.info('Documentation content loaded', { itemCount: items.length });
  return { items };
}

async function readChangelog() {
  try {
    const entries = await getChangelogEntries();
    if (entries.length) return entries;
  } catch {
    // Storage reports the underlying exception. Keep ingestion writes strict;
    // the read-only dashboard can recover directly from canonical Git history.
    Sentry.logger.warn('Documentation storage unavailable; reading GitHub history');
  }
  try {
    return await loadDocsHistory();
  } catch {
    Sentry.logger.warn('Documentation GitHub history unavailable; using static content');
    return [];
  }
}

async function fetchStaticDocs(): Promise<unknown[]> {
  try {
    const data = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'docs-pages.json'), 'utf8'));
    if (!Array.isArray(data.knownPages)) throw new Error('Invalid docs storage');
    return data.knownPages;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
