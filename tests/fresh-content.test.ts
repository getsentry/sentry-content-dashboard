import { afterEach, expect, test, vi } from 'vitest';
import { loadDashboardContent, type DashboardContent } from '../src/utils/loadDashboardContent';
import { CONTENT_SOURCES, type ContentEvent, type ContentSource } from '../src/utils/content';
afterEach(() => vi.unstubAllGlobals());
const encoder = new TextEncoder();
const line = (event: ContentEvent) => encoder.encode(JSON.stringify(event) + '\n');
function event(source: ContentSource, title = 'Fresh', refreshing = false): ContentEvent {
  return { type: 'source', source, refreshing, snapshot: { fetchedAt: Date.now(), items: [{ id: source, title, url: 'https://example.com', publishedAt: '2026-09-16', description: '', source, categories: [] }] } };
}
function stream(events: ContentEvent[]) {
  return new Response(new ReadableStream({ start(controller) { events.forEach(e => controller.enqueue(line(e))); controller.close(); } }));
}
test('one stream on each visit retrieves newly published content', async () => {
  let title = 'Original';
  const fetchMock = vi.fn(async () => stream([...CONTENT_SOURCES.map(source => event(source, title)), { type: 'done' }]));
  vi.stubGlobal('fetch', fetchMock);
  expect((await loadDashboardContent(new AbortController().signal)).items[0].title).toBe('Original');
  title = 'Newly published';
  expect((await loadDashboardContent(new AbortController().signal)).items.every(item => item.title === title)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0]).toEqual(['/api/content?refresh=1', expect.objectContaining({ cache: 'no-store' })]);
});
test('publishes ready content while the slow source is still pending', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(c) { controller = c; } }))));
  const progress: DashboardContent[] = [];
  const loading = loadDashboardContent(new AbortController().signal, update => progress.push(update));
  await vi.waitFor(() => expect(controller).toBeDefined());
  controller.enqueue(line(event('docs')));
  await vi.waitFor(() => expect(progress).toHaveLength(1));
  expect(progress[0].items[0].source).toBe('docs');
  expect(progress[0].pendingSources).toContain('blog');
  for (const source of ['blog', 'changelog'] as const) controller.enqueue(line(event(source)));
  controller.enqueue(line({ type: 'error', source: 'youtube' }));
  controller.enqueue(line({ type: 'done' })); controller.close();
  const result = await loading;
  expect(result.items).toHaveLength(3); expect(result.failedSources).toEqual(['youtube']);
});
test('snapshot is replaced by fresh data in the same visit without duplicates', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => stream([
    event('docs', 'Snapshot', true), event('docs', 'Updated'),
    ...(['blog', 'youtube', 'changelog'] as const).map(source => event(source)), { type: 'done' },
  ])));
  const progress: DashboardContent[] = [];
  const result = await loadDashboardContent(new AbortController().signal, value => progress.push(value));
  expect(progress[0].items[0].title).toBe('Snapshot');
  expect(result.items.filter(item => item.source === 'docs').map(item => item.title)).toEqual(['Updated']);
});
test('truncated stream retains delivered content and flags missing sources', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => stream([event('docs')])));
  const result = await loadDashboardContent(new AbortController().signal);
  expect(result.items).toHaveLength(1);
  expect(result.failedSources).toEqual(['blog', 'youtube', 'changelog']);
});
test('handles records split across chunks including multibyte text', async () => {
  const bytes = encoder.encode([...CONTENT_SOURCES.map(source => event(source, 'Fresh 🎉')), { type: 'done' }].map(e => JSON.stringify(e)).join('\n'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  } }))));
  expect((await loadDashboardContent(new AbortController().signal)).items.every(item => item.title === 'Fresh 🎉')).toBe(true);
});

test('quota deferral preserves saved content and settles pending status', async () => {
  const youtube = event('youtube', 'Saved');
  if (youtube.type === 'source') youtube.snapshot.refreshDeferredUntil = Date.now() + 10000;
  vi.stubGlobal('fetch', vi.fn(async () => stream([
    youtube, ...(['blog', 'docs', 'changelog'] as const).map(source => event(source)), { type: 'done' },
  ])));
  const result = await loadDashboardContent(new AbortController().signal);
  expect(result.deferredSources).toEqual(['youtube']);
  expect(result.pendingSources).toEqual([]);
  expect(result.failedSources).toEqual([]);
  expect(result.items.find(item => item.source === 'youtube')?.title).toBe('Saved');
});

test('busy source retains content, settles the spinner, and exposes retry warning', async () => {
  const busy = event('blog', 'Saved');
  if (busy.type === 'source') busy.snapshot.refreshBusy = true;
  vi.stubGlobal('fetch', vi.fn(async () => stream([
    busy, ...(['youtube', 'docs', 'changelog'] as const).map(source => event(source)), { type: 'done' },
  ])));
  const result = await loadDashboardContent(new AbortController().signal);
  expect(result.failedSources).toEqual(['blog']);
  expect(result.pendingSources).toEqual([]);
  expect(result.items.find(item => item.source === 'blog')?.title).toBe('Saved');
});
