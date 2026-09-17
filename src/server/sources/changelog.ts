import { fetchFeed, validators } from '../fetchFeed';
import type { SourcePayload, SourceSnapshot } from '../../utils/content';
import * as Sentry from '@sentry/nextjs';
import { parseISO } from 'date-fns';
import { detectCategories } from '../../utils/categoryDetector';

interface ChangelogItem {
  id: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: 'changelog';
  categories: string[];
}

export async function load(previous?: SourceSnapshot): Promise<SourcePayload> {
    console.log('Changelog API request received');

    // Fetch only official changelog (docs changes now go to docs API)
    const feed = await fetchOfficialChangelog(previous);
    const officialChangelog = feed.items;

    // Filter items from the last 90 days for consistency with other dynamic sources
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentItems = officialChangelog.filter(item => {
      const itemDate = parseISO(item.publishedAt);
      return itemDate >= ninetyDaysAgo;
    });

    console.log(`Returning ${recentItems.length} official changelog entries`);
    return { items: recentItems, ...feed.validators };
}

async function fetchOfficialChangelog(previous?: SourceSnapshot) {
  try {
    const feedUrl = 'https://sentry.io/changelog/feed.xml';
    const response = await fetchFeed(feedUrl, previous);
    if (response.status === 304 && previous) return { items: previous.items, validators: { etag: previous.etag, lastModified: previous.lastModified } };
    if (!response.ok) {
      console.error('Changelog feed fetch failed:', response.status, response.statusText);
      throw new Error(`Changelog feed unavailable (${response.status})`);
    }

    const xmlText = await response.text();
    return { items: parseChangelogFeed(xmlText), validators: validators(response) };
  } catch (error) {
    Sentry.captureException(error);
    console.error('Error fetching official changelog:', error);
    throw error;
  }
}

function parseChangelogFeed(xmlText: string): ChangelogItem[] {
  const items: ChangelogItem[] = [];

  try {
    // Support both RSS (<item>) and Atom (<entry>) formats
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;

    let match;

    // RSS items
    while ((match = itemRegex.exec(xmlText)) !== null) {
      const content = match[1];
      const title = extractTag(content, 'title');
      const link = extractTag(content, 'link');
      const description = extractTag(content, 'description');
      const pubDate = extractTag(content, 'pubDate');

      if (title && link) {
        const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
        const categories = detectCategories(cleanCDATA(title), cleanCDATA(description || ''), 'changelog');
        items.push({
          id: `changelog-${new URL(link.trim()).href}`,
          title: cleanCDATA(title),
          description: cleanCDATA(description || ''),
          url: link.trim(),
          publishedAt,
          source: 'changelog',
          categories
        });
      }
    }

    // Atom entries
    while ((match = entryRegex.exec(xmlText)) !== null) {
      const content = match[1];
      const title = extractTag(content, 'title');
      const updated = extractTag(content, 'updated');
      const summary = extractTag(content, 'summary') || extractTag(content, 'content');
      const linkHrefMatch = content.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/>/);
      const link = linkHrefMatch ? linkHrefMatch[1] : '';

      if (title && link) {
        const publishedAt = updated ? new Date(updated).toISOString() : new Date().toISOString();
        const categories = detectCategories(cleanCDATA(title), cleanCDATA(summary || ''), 'changelog');
        items.push({
          id: `changelog-${new URL(link.trim()).href}`,
          title: cleanCDATA(title),
          description: cleanCDATA(summary || ''),
          url: link.trim(),
          publishedAt,
          source: 'changelog',
          categories
        });
      }
    }
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }

  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : undefined;
}

function cleanCDATA(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
