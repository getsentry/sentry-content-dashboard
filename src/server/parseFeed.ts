import * as Sentry from '@sentry/nextjs';
import { load } from 'cheerio';
import { detectCategories } from '../utils/categoryDetector';
import type { ContentItem } from '../utils/content';

function htmlText(html: string) {
  const $ = load(html);
  $('script, style').remove();
  // Text extraction is not HTML sanitization; consumers must render this as text.
  return $.root().text().trim();
}

export function parseFeed(xml: string, source: 'blog' | 'changelog'): ContentItem[] {
  const $ = load(xml, { xmlMode: true });
  const atom = $('feed').length > 0;
  if (!atom && !$('rss > channel').length) throw new Error('Invalid RSS/Atom feed');
  const items: ContentItem[] = [];
  const feedUrl = source === 'blog' ? 'https://blog.sentry.io/feed.xml' : 'https://sentry.io/changelog/feed.xml';
  let skipped = 0;
  let firstError: unknown;
  $(atom ? 'feed > entry' : 'rss > channel > item').each((_, element) => {
    try {
      const entry = $(element);
      const field = (name: string) => entry.children().filter((_, node) => 'name' in node && node.name === name).first();
      const text = (name: string, rssHtml = false) => {
        const node = field(name);
        const type = node.attr('type');
        if (atom && type === 'xhtml') {
          const copy = node.clone();
          copy.find('script, style').remove();
          return copy.text().trim();
        }
        // XML parsing decodes the envelope once; only HTML fields have another layer.
        const value = node.text();
        return (atom ? type === 'html' : rssHtml) ? htmlText(value) : value.trim();
      };
      const title = text('title');
      const url = atom
        ? entry.children('link').filter((_, node) => !$(node).attr('rel') || $(node).attr('rel') === 'alternate').first().attr('href')
        : field('link').text().trim();
      if (!title || !url) throw new Error('Feed item is missing its title or link');
      const rootBase = new URL($('feed').attr('xml:base') || feedUrl, feedUrl);
      const entryBase = new URL(entry.attr('xml:base') || rootBase.href, rootBase);
      const canonical = new URL(url, entryBase);
      if (!['https:', 'http:'].includes(canonical.protocol)) throw new Error('Invalid feed link');
      const description = atom ? text(field('summary').length ? 'summary' : 'content') : text('description', true);
      const date = atom ? text('updated') || text('published') : text('pubDate');
      const publishedAt = date ? new Date(date).toISOString() : new Date().toISOString();
      const author = atom ? field('author').find('name').text().trim() : text('dc:creator');
      items.push({ id: `${source}-${canonical.href}`, title, description, url: canonical.href,
        publishedAt, source, categories: detectCategories(title, description, source),
        ...(author ? { author } : {}),
      });
    } catch (error) {
      skipped++;
      firstError ??= error;
    }
  });
  if (skipped) {
    Sentry.logger.warn('Skipped invalid feed entries', { source, count: skipped });
    // Never replace a last-good snapshot with an entirely invalid feed.
    if (!items.length) throw new Error('Feed contains no valid entries', { cause: firstError });
    Sentry.captureException(firstError);
  }
  return items;
}
