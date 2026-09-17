import { unstable_cache } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { config } from '../../../config';
import { normalizeContent } from '../../utils/content';

// This cache uses Next's persistent Data Cache, independently of REDIS_URL.
// Never fall back to the expensive search endpoint without shared admission.
async function request(resource: string, params: Record<string, string>) {
  const query = new URLSearchParams({ ...params, key: config.youtube.apiKey });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${query}`, {
    cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
  // Do not put credential-bearing request URLs or provider payloads in errors.
  if (!response.ok) throw new Error(`YouTube ${resource} request failed (${response.status})`);
  return response.json();
}

const uploadsPlaylist = unstable_cache(async (channelId: string) => {
  const data = await request('channels', { id: channelId, part: 'contentDetails' });
  const playlist = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (typeof playlist !== 'string' || !playlist) throw new Error('YouTube uploads playlist missing');
  return playlist;
}, ['youtube-uploads-playlist-v1'], { revalidate: 86400 });

const cachedUploads = unstable_cache(async (channelId: string, maximum: number) => {
  const playlistId = await uploadsPlaylist(channelId);
  const data = await request('playlistItems', {
    playlistId, part: 'snippet,contentDetails', maxResults: String(maximum),
  });
  if (!Array.isArray(data.items)) throw new Error('Invalid YouTube uploads response');
  const items = data.items.flatMap((item: {
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
    snippet?: { title?: string; description?: string; thumbnails?: Record<string, { url?: string }> };
  }) => {
    // Deleted/private playlist entries can omit video metadata. Isolate them
    // rather than hiding every public upload in the same response.
    if (!item.contentDetails?.videoId || !item.snippet?.title ||
        !item.contentDetails.videoPublishedAt || !Number.isFinite(Date.parse(item.contentDetails.videoPublishedAt))) {
      Sentry.logger.warn('Skipped unavailable YouTube playlist entry');
      return [];
    }
    return [{
      id: item.contentDetails?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.contentDetails?.videoId || '')}`,
      // Playlist insertion time is not the video's publication time.
      publishedAt: item.contentDetails?.videoPublishedAt,
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
    }];
  });
  if (data.items.length && !items.length) throw new Error('YouTube uploads contained no valid videos');
  return normalizeContent(items, 'youtube');
}, ['youtube-uploads-content-v1'], { revalidate: 1200 });

export async function loadUploads() {
  const items = await cachedUploads(config.youtube.channelId, config.youtube.maxResults);
  const cutoff = Date.now() - config.content.daysToShow * 86400000;
  return { items: items.filter(item => Date.parse(item.publishedAt) >= cutoff) };
}
