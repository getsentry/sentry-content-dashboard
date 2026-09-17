import * as Sentry from '@sentry/nextjs';
import { load as blog } from './sources/blog';
import { load as youtube } from './sources/youtube';
import { load as docs } from './sources/docs';
import { load as changelog } from './sources/changelog';
import { SourceCache } from './sourceCache';
import { redisSnapshots } from './redisSnapshots';
import { CONTENT_SOURCES, type ContentSource, type ContentEvent } from '../utils/content';

const processState = globalThis as typeof globalThis & { contentCacheV1?: SourceCache };
export const contentCache = processState.contentCacheV1 ??= new SourceCache(
  { blog, youtube, docs, changelog }, process.env.REDIS_URL ? redisSnapshots : undefined,
);

export async function refreshSource(source: ContentSource, force = false) {
  return Sentry.startSpan({ name: `Refresh ${source} content`, op: 'content.refresh', attributes: { 'content.source': source, 'content.force': force } },
    () => contentCache.refresh(source, force));
}

export async function streamContent(emit: (event: ContentEvent) => void, force: boolean) {
  await Promise.all(CONTENT_SOURCES.map(async source => {
    try {
      const cached = await contentCache.read(source);
      if (cached) emit({ type: 'source', source, snapshot: cached, refreshing: true });
      const snapshot = await refreshSource(source, force);
      emit({ type: 'source', source, snapshot, refreshing: false });
    } catch (error) {
      Sentry.captureException(error);
      Sentry.logger.warn('Content source unavailable', { source });
      emit({ type: 'error', source });
    }
  }));
  emit({ type: 'done' });
}
