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
  $(atom ? 'feed > entry' : 'rss > channel > item').each((_, element) => {
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
    if (!title || !url) return;
    const canonical = new URL(url);
    if (!['https:', 'http:'].includes(canonical.protocol)) throw new Error('Invalid feed link');
    const description = atom ? text(field('summary').length ? 'summary' : 'content') : text('description', true);
    const date = atom ? text('updated') || text('published') : text('pubDate');
    const publishedAt = date ? new Date(date).toISOString() : new Date().toISOString();
    const author = atom ? field('author').find('name').text().trim() : text('dc:creator');
    items.push({ id: `${source}-${canonical.href}`, title, description, url,
      publishedAt, source, categories: detectCategories(title, description, source),
      ...(author ? { author } : {}),
    });
  });
  return items;
}
