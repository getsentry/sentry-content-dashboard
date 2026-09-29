import * as Sentry from '@sentry/nextjs';
import { readFile } from 'fs/promises';
import path from 'path';
import { normalizeContent } from '../../utils/content';

// Customer stories are undated upstream, so `scripts/monitor-customers.js` dates
// each one from when it first appeared and records it here. Stories already
// published when the baseline was seeded are intentionally absent.
export async function load() {
  const stories = await readStories();
  const items = normalizeContent(stories, 'customers')
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  Sentry.logger.info('Customer story content loaded', { itemCount: items.length });
  return { items };
}

async function readStories(): Promise<unknown[]> {
  try {
    const data = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'customer-stories.json'), 'utf8'));
    if (!Array.isArray(data.stories)) throw new Error('Invalid customer story storage');
    return data.stories;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
