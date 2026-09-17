import { CONTENT_SOURCES, type ContentSource, type ContentItem, type ContentEvent } from './content';

export interface DashboardContent {
  items: ContentItem[];
  failedSources: ContentSource[];
  pendingSources: ContentSource[];
}
export async function loadDashboardContent(
  signal: AbortSignal,
  onProgress: (result: DashboardContent) => void = () => {},
  options: { refresh?: boolean; initialItems?: ContentItem[] } = {},
): Promise<DashboardContent> {
  const bySource = new Map<ContentSource, ContentItem[]>();
  for (const source of CONTENT_SOURCES) {
    bySource.set(source, (options.initialItems || []).filter(item => item.source === source));
  }
  const failed = new Set<ContentSource>();
  const pending = new Set<ContentSource>(CONTENT_SOURCES);
  const result = () => ({
    items: [...bySource.values()].flat().sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    failedSources: [...failed], pendingSources: [...pending],
  });
  const response = await fetch(`/api/content${options.refresh === false ? '' : '?refresh=1'}`, {
    cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
  });
  if (!response.ok || !response.body) throw new Error('Content stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event: ContentEvent = JSON.parse(line);
    if (event.type === 'done') { done = true; return; }
    if (!('source' in event) || !CONTENT_SOURCES.includes(event.source)) throw new Error('Invalid content source');
    if (event.type === 'source') {
      if (!Array.isArray(event.snapshot?.items)) throw new Error('Invalid content snapshot');
      bySource.set(event.source, event.snapshot.items);
      if (!event.refreshing) pending.delete(event.source);
    } else if (event.type === 'error') {
      failed.add(event.source);
      pending.delete(event.source);
    } else throw new Error('Invalid content event');
    onProgress(result());
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!done || pending.size) throw new Error('Content stream ended before all sources settled');
  } catch (error) {
    if (signal.aborted) throw error;
    // Retain already delivered content, but never claim an interrupted stream completed.
    if (![...bySource.values()].some(items => items.length)) throw error;
    pending.forEach(source => failed.add(source));
    pending.clear();
    onProgress(result());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return result();
}
