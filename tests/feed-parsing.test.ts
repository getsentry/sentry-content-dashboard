import { afterEach, expect, test, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
afterEach(() => vi.clearAllMocks());
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseFeed } from '../src/server/parseFeed';
import { markdownText } from '../src/server/markdownText';
const rss = (fields: string) => `<rss><channel><item>${fields}<link>https://example.com/post?a=1&amp;b=2</link><pubDate>2026-09-17T00:00:00Z</pubDate></item></channel></rss>`;
test.each(['blog', 'changelog'] as const)('%s decodes each layer once and preserves literal examples', source => {
  const [item] = parseFeed(rss(`<title>&amp;lt;script&amp;gt; &amp; &#x1F389;</title><description><![CDATA[
    <p>Use &lt;script&gt; and &amp;lt;b&amp;gt; as examples.</p>
    <script>alert(1)</script><style>body{}</style>
  ]]></description><dc:creator>A &amp; B</dc:creator>`), source);
  expect(item.title).toBe('&lt;script&gt; & 🎉');
  expect(item.description).toBe('Use <script> and &lt;b&gt; as examples.');
  expect(item.author).toBe('A & B');
  expect(item.id).toBe(`${source}-https://example.com/post?a=1&b=2`);
  expect(item.publishedAt).toBe('2026-09-17T00:00:00.000Z');
  expect(item.categories).toBeInstanceOf(Array);
  expect(renderToStaticMarkup(createElement('p', null, item.description))).not.toContain('<script>');
});
test('Atom plain text, HTML and XHTML retain their own encoding semantics', () => {
  const xml = `<feed><entry><title type="text">&lt;img&gt;</title><summary type="html">&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;</summary><link rel="self" href="https://example.com/api"/><link rel="alternate" href="https://example.com/post"/><updated>2026-09-17</updated></entry><entry><title type="xhtml"><div><b>Bold</b></div></title><content type="xhtml"><div>Safe<script>bad</script><style>bad</style></div></content><link href="https://example.com/two"/><published>2026-09-16</published></entry></feed>`;
  const items = parseFeed(xml, 'changelog');
  expect(items.map(item => [item.title, item.description])).toEqual([['<img>', 'Hi & bye'], ['Bold', 'Safe']]);
  expect(items[0].url).toBe('https://example.com/post');
});
test('malformed nested tags do not become active HTML through text rendering or export', () => {
  const [item] = parseFeed(rss('<title>Test</title><description><![CDATA[<scr<script>ipt><img src=x onerror=alert(1)>Text]]></description>'), 'blog');
  const rendered = renderToStaticMarkup(createElement('p', null, item.description));
  expect(rendered).not.toMatch(/<(script|img)/i);
  expect(markdownText('<img src=x>\n[click](javascript:alert(1))')).toBe('&lt;img src=x&gt; \\[click\\]\\(javascript:alert\\(1\\)\\)');
});
test('invalid feed envelopes fail instead of publishing an empty success', () => {
  expect(() => parseFeed('<html>upstream error</html>', 'blog')).toThrow('Invalid RSS/Atom');
  expect(parseFeed('<rss><channel/></rss>', 'blog')).toEqual([]);
});

test('relative feed links resolve against the source and Atom xml:base', () => {
  const relative = '<rss><channel><item><title>Relative</title><link>/new-post/</link></item></channel></rss>';
  expect(parseFeed(relative, 'blog')[0].url).toBe('https://blog.sentry.io/new-post/');
  const atom = '<feed xml:base="https://example.com/updates/"><entry xml:base="v2/"><title>Release</title><link href="new"/></entry></feed>';
  expect(parseFeed(atom, 'changelog')[0].url).toBe('https://example.com/updates/v2/new');
});
test('bad links or dates cannot hide healthy entries, but an entirely invalid feed fails', () => {
  const valid = '<item><title>Healthy</title><link>https://example.com/good</link><pubDate>2026-09-17</pubDate></item>';
  const bad = '<item><title>Bad URL</title><link>http://[broken</link></item><item><title>Bad date</title><link>https://example.com/date</link><pubDate>invalid-date</pubDate></item><item><title>Unsafe</title><link>javascript:alert(1)</link></item>';
  expect(parseFeed(`<rss><channel>${bad}${valid}</channel></rss>`, 'blog').map(item => item.title)).toEqual(['Healthy']);
  expect(Sentry.logger.warn).toHaveBeenCalledWith('Skipped invalid feed entries', { source: 'blog', count: 3 });
  expect(Sentry.captureException).toHaveBeenCalledOnce();
  expect(() => parseFeed(`<rss><channel>${bad}</channel></rss>`, 'blog')).toThrow('no valid entries');
});
