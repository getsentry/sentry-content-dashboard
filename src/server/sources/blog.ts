import { fetchFeed, validators } from '../fetchFeed';
import type { SourcePayload, SourceSnapshot } from '../../utils/content';
import * as Sentry from '@sentry/nextjs';
import { subDays, parseISO } from 'date-fns';
import { detectCategories } from '../../utils/categoryDetector';

interface BlogPost {
  id: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: 'blog';
  author?: string;
  categories: string[];
}

export async function load(previous?: SourceSnapshot): Promise<SourcePayload> {
    console.log('Blog API request received');
    console.log('Environment check:', {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
    });

    // Sentry blog RSS feed URL
    const rssUrl = 'https://blog.sentry.io/feed.xml';

    console.log('Fetching RSS feed from:', rssUrl);

    // Fetch the RSS feed
    const response = await fetchFeed(rssUrl, previous);
    if (response.status === 304 && previous) return previous;
    if (!response.ok) {
      console.error('RSS feed fetch failed:', response.status, response.statusText);
      throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log('RSS feed fetched successfully, length:', xmlText.length);

    // Parse the XML to extract blog posts
    const posts = parseRSSFeed(xmlText);
    console.log('Parsed posts count:', posts.length);

    // Filter posts from the last 90 days
    const ninetyDaysAgo = subDays(new Date(), 90);
    const recentPosts = posts.filter(post => {
      const postDate = parseISO(post.publishedAt);
      return postDate >= ninetyDaysAgo;
    });

    console.log('Recent posts count:', recentPosts.length);
    return { items: recentPosts, ...validators(response) };
}

function parseRSSFeed(xmlText: string): BlogPost[] {
  const posts: BlogPost[] = [];

  try {
    // Simple XML parsing using regex (for production, consider using a proper XML parser)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemContent = match[1];

      // Extract title
      const titleMatch = itemContent.match(/<title>(.*?)<\/title>/);
      const title = titleMatch ? decodeXMLEntities(titleMatch[1].trim()) : '';

      // Extract description
      const descriptionMatch = itemContent.match(/<description>(.*?)<\/description>/);
      const description = descriptionMatch ? decodeXMLEntities(descriptionMatch[1].trim()) : '';

      // Extract link
      const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
      const url = linkMatch ? linkMatch[1].trim() : '';

      // Extract publication date
      const pubDateMatch = itemContent.match(/<pubDate>(.*?)<\/pubDate>/);
      const publishedAt = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : new Date().toISOString();

      // Extract author
      const authorMatch = itemContent.match(/<dc:creator>(.*?)<\/dc:creator>/);
      const author = authorMatch ? decodeXMLEntities(authorMatch[1].trim()) : undefined;

      if (title && url) {
        const categories = detectCategories(cleanCDATA(title), cleanCDATA(description), 'blog');
        posts.push({
          id: `blog-${new URL(url).href}`,
          title: cleanCDATA(title),
          description: cleanCDATA(description),
          url,
          publishedAt,
          source: 'blog',
          author,
          categories,
        });
      }
    }
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }

  return posts;
}

function cleanCDATA(text: string): string {
  // Remove CDATA tags and clean up the content
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1') // Remove CDATA tags
    .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
    .trim();
}

function decodeXMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
