import { detectCategories } from './categoryDetector';

export const CONTENT_SOURCES = ['blog', 'youtube', 'docs', 'changelog'] as const;
export type ContentSource = typeof CONTENT_SOURCES[number];
export interface ContentItem {
  id: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: ContentSource;
  categories: string[];
  thumbnail?: string;
  author?: string;
  duration?: string;
  lastModified?: string;
}

export function normalizeContent(value: unknown, source: ContentSource): ContentItem[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${source} response`);
  return value.map(item => {
    if (!item || typeof item.url !== 'string' || typeof item.title !== 'string') throw new Error(`Invalid ${source} item`);
    const url = new URL(item.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid content URL');
    const date = item.publishedAt || item.lastModified;
    if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) throw new Error(`Invalid ${source} date`);
    const description = typeof item.description === 'string' ? item.description : '';
    return {
      ...item,
      id: typeof item.id === 'string' && item.id ? item.id : `${source}-${item.url}`,
      title: item.title,
      description,
      url: item.url,
      publishedAt: new Date(date).toISOString(),
      source,
      categories: Array.isArray(item.categories) && item.categories.every((c: unknown) => typeof c === 'string')
        ? item.categories : detectCategories(item.title, description, source),
    };
  });
}

export async function collectContent(loaders: Record<ContentSource, () => Promise<unknown>>) {
  const results = await Promise.allSettled(CONTENT_SOURCES.map(async source =>
    normalizeContent(await loaders[source](), source)));
  const items: ContentItem[] = [];
  const failedSources: ContentSource[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value);
    else failedSources.push(CONTENT_SOURCES[index]);
  });
  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { items, failedSources };
}

export interface SourcePayload {
  items: unknown;
  etag?: string;
  lastModified?: string;
}
export interface SourceSnapshot extends SourcePayload {
  items: ContentItem[];
  fetchedAt: number;
  refreshDeferredUntil?: number;
}
export type ContentEvent =
  | { type: 'source'; source: ContentSource; snapshot: SourceSnapshot; refreshing: boolean }
  | { type: 'error'; source: ContentSource }
  | { type: 'done' };
