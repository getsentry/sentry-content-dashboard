import * as Sentry from '@sentry/nextjs';
import { readFile } from 'fs/promises';
import path from 'path';
import { getChangelogEntries } from '../../utils/changelogStorage';
import { normalizeContent } from '../../utils/content';

export async function load() {
  const [staticDocs, changelog] = await Promise.all([fetchStaticDocs(), getChangelogEntries()]);
  const items = normalizeContent([...staticDocs, ...changelog], 'docs')
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  Sentry.logger.info('Documentation content loaded', { itemCount: items.length });
  return { items };
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
