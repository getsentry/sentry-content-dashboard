import { reserveYouTubeRefresh } from '../youtubeQuota';
import { fetchFeed, validators } from '../fetchFeed';
import type { SourcePayload, SourceSnapshot } from '../../utils/content';
import { subDays, parseISO } from 'date-fns';
import { config } from '../../../config';
import { detectCategories } from '../../utils/categoryDetector';

interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: 'youtube';
  thumbnail?: string;
  duration?: string;
  categories: string[];
}

interface YouTubeAPIResponse {
  items: Array<{
    id: {
      videoId: string;
    };
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      thumbnails?: Partial<Record<'medium' | 'default' | 'high', { url?: string }>>;
    };
  }>;
}

export async function load(previous?: SourceSnapshot): Promise<SourcePayload> {
    // Check if API key is configured
    if (!config.youtube.apiKey) throw new Error('YouTube is not configured');

    const apiUrl = `https://www.googleapis.com/youtube/v3/search?` +
      `key=${config.youtube.apiKey}&` +
      `channelId=${config.youtube.channelId}&` +
      `part=snippet&` +
      `order=date&` +
      `maxResults=${config.youtube.maxResults}&` +
      `type=video`;


    // Fetch videos from Sentry's YouTube channel
    await reserveYouTubeRefresh();
    const response = await fetchFeed(apiUrl, previous);

    if (response.status === 304 && previous) return previous;
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`YouTube API error: ${response.status} - ${errorText}`);
    }

    const data: YouTubeAPIResponse = await response.json();

    // Transform API response to our video format
    const videos: YouTubeVideo[] = data.items.map(item => {
      const categories = detectCategories(item.snippet.title, item.snippet.description, 'youtube');
      return {
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        publishedAt: item.snippet.publishedAt,
        source: 'youtube',
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || item.snippet.thumbnails?.high?.url,
        categories,
      };
    });

    // Filter videos from the last 90 days
    const cutoffDate = subDays(new Date(), config.content.daysToShow);
    const recentVideos = videos.filter(video => {
      const videoDate = parseISO(video.publishedAt);
      return videoDate >= cutoffDate;
    });

    return { items: recentVideos, ...validators(response) };
}
