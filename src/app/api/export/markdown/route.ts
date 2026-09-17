import { markdownText } from '../../../../server/markdownText';
import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { collectContent, type ContentItem } from '../../../../utils/content';
import { refreshSource } from '../../../../server/contentService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('Markdown export API request received');

    const deferred: string[] = [];
    const load = (source: Parameters<typeof refreshSource>[0]) => async () => {
      const snapshot = await refreshSource(source);
      if (snapshot.refreshDeferredUntil) deferred.push(source);
      return snapshot.items;
    };
    const { items, failedSources } = await collectContent({
      blog: load('blog'), youtube: load('youtube'), docs: load('docs'), changelog: load('changelog'),
    });
    if (failedSources.length === 4) {
      return NextResponse.json({ error: 'All content sources are unavailable' }, { status: 503 });
    }
    const warning = failedSources.length
      ? `> Partial export. Unavailable sources: ${failedSources.join(', ')}.\n\n` : '';
    const deferredWarning = deferred.length ? `> Saved content; refresh deferred: ${deferred.join(', ')}.\n\n` : '';
    const markdown = warning + deferredWarning + generateMarkdown(items);

    // Return as markdown with proper content type
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'X-Unavailable-Sources': failedSources.join(','),
        'Content-Disposition': 'attachment; filename="sentry-content-export.md"'
      }
    });

  } catch (error) {
    Sentry.captureException(error);
    console.error('Error generating markdown export:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate markdown export',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

function generateMarkdown(content: ContentItem[]): string {
  const now = new Date().toISOString();
  
  let markdown = `# Sentry Content Aggregator - Export\n\n`;
  markdown += `Generated on: ${now}\n`;
  markdown += `Total items: ${content.length}\n\n`;
  
  // Group content by source
  const groupedContent = {
    blog: content.filter(item => item.source === 'blog'),
    youtube: content.filter(item => item.source === 'youtube'),
    docs: content.filter(item => item.source === 'docs'),
    changelog: content.filter(item => item.source === 'changelog')
  };

  // Blog Posts Section
  if (groupedContent.blog.length > 0) {
    markdown += `## 📝 Blog Posts (${groupedContent.blog.length})\n\n`;
    groupedContent.blog.forEach((post, index) => {
      markdown += `### ${index + 1}. ${markdownText(post.title)}\n`;
      markdown += `- **URL**: ${markdownText(post.url)}\n`;
      markdown += `- **Published**: ${post.publishedAt}\n`;
      if (post.author) markdown += `- **Author**: ${markdownText(post.author)}\n`;
      if (post.description) markdown += `- **Description**: ${markdownText(post.description)}\n`;
      markdown += `\n`;
    });
  }

  // YouTube Videos Section
  if (groupedContent.youtube.length > 0) {
    markdown += `## 🎥 YouTube Videos (${groupedContent.youtube.length})\n\n`;
    groupedContent.youtube.forEach((video, index) => {
      markdown += `### ${index + 1}. ${markdownText(video.title)}\n`;
      markdown += `- **URL**: ${markdownText(video.url)}\n`;
      markdown += `- **Published**: ${video.publishedAt}\n`;
      if (video.duration) markdown += `- **Duration**: ${markdownText(video.duration)}\n`;
      if (video.description) markdown += `- **Description**: ${markdownText(video.description)}\n`;
      markdown += `\n`;
    });
  }

  // Documentation Section
  if (groupedContent.docs.length > 0) {
    markdown += `## 📚 Documentation (${groupedContent.docs.length})\n\n`;
    groupedContent.docs.forEach((doc, index) => {
      markdown += `### ${index + 1}. ${markdownText(doc.title)}\n`;
      markdown += `- **URL**: ${markdownText(doc.url)}\n`;
      markdown += `- **Last Modified**: ${doc.lastModified || doc.publishedAt}\n`;
      if (doc.description) markdown += `- **Description**: ${markdownText(doc.description)}\n`;
      markdown += `\n`;
    });
  }

  // Changelog Section
  if (groupedContent.changelog.length > 0) {
    markdown += `## 🗒️ Changelog Updates (${groupedContent.changelog.length})\n\n`;
    groupedContent.changelog.forEach((item, index) => {
      markdown += `### ${index + 1}. ${markdownText(item.title)}\n`;
      markdown += `- **URL**: ${markdownText(item.url)}\n`;
      markdown += `- **Published**: ${item.publishedAt}\n`;
      if (item.description) markdown += `- **Description**: ${markdownText(item.description)}\n`;
      markdown += `\n`;
    });
  }

  // Summary
  markdown += `## 📊 Summary\n\n`;
  markdown += `- **Blog Posts**: ${groupedContent.blog.length}\n`;
  markdown += `- **YouTube Videos**: ${groupedContent.youtube.length}\n`;
  markdown += `- **Documentation**: ${groupedContent.docs.length}\n`;
  markdown += `- **Changelog Updates**: ${groupedContent.changelog.length}\n`;
  markdown += `- **Total Content Items**: ${content.length}\n\n`;
  
  markdown += `---\n`;
  markdown += `*This export was generated by the Sentry Content Aggregator for LLM ingestion and analysis.*\n`;

  return markdown;
}
