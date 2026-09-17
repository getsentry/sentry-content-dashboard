import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { getChangelogEntries } from '../../../../utils/changelogStorage';

interface ChangelogEntry {
  aiSummary?: string;
  author: string;
  description?: string;
  id: string;
  publishedAt: string;
  title: string;
  url: string;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Load changelog from storage
    const changelog: ChangelogEntry[] = await getChangelogEntries();

    // Generate RSS feed
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Sentry Documentation Changelog</title>
    <link>https://docs.sentry.io/changelog</link>
    <description>Recent updates to Sentry documentation</description>
    <atom:link href="https://sentry-content-dashboard.sentry.dev/api/docs/feed" rel="self" type="application/rss+xml"/>
    ${changelog.map((entry) => `
    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.url)}</link>
      <description>${escapeXml(entry.description || entry.aiSummary || 'No description available')}</description>
      <pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>
      <guid>${entry.url}</guid>
      <author>${escapeXml(entry.author)}</author>
    </item>
    `).join('\n')}
  </channel>
</rss>`;

    return new NextResponse(rss, {
      headers: {
        'Content-Type': 'application/rss+xml',
        'Cache-Control': 'no-store, max-age=0'
      }
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error('Error generating RSS feed:', error);
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 });
  }
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

