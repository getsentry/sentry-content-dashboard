import { expect, test, vi } from 'vitest';
import type { ContentEvent } from '../src/utils/content';
const mocks = vi.hoisted(() => ({ blog: vi.fn(), youtube: vi.fn(), docs: vi.fn(), changelog: vi.fn() }));
vi.mock('../src/server/sources/blog', () => ({ load: mocks.blog }));
vi.mock('../src/server/sources/youtube', () => ({ load: mocks.youtube }));
vi.mock('../src/server/sources/docs', () => ({ load: mocks.docs }));
vi.mock('../src/server/sources/changelog', () => ({ load: mocks.changelog }));
import { GET } from '../src/app/api/content/route';
test('server emits ready sources before stalled source and closes with an explicit completion', async () => {
  let release!: (value: { items: never[] }) => void;
  mocks.blog.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  mocks.docs.mockResolvedValue({ items: [{ title: 'Fast docs', url: 'https://docs.sentry.io', publishedAt: '2026-09-17' }] });
  mocks.changelog.mockResolvedValue({ items: [] });
  mocks.youtube.mockRejectedValue(Error('not configured'));
  const response = await GET(new Request('http://localhost/api/content?refresh=1'));
  expect(response.headers.get('content-type')).toContain('ndjson');
  expect(response.headers.get('cache-control')).toContain('no-transform');
  const reader = response.body!.getReader();
  const events: ContentEvent[] = [];
  const decoder = new TextDecoder();
  while (!events.some(event => event.type === 'source' && event.source === 'docs')) {
    const { value } = await reader.read();
    events.push(JSON.parse(decoder.decode(value)));
  }
  expect(events.some(event => event.type === 'done')).toBe(false);
  release({ items: [] });
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; events.push(JSON.parse(decoder.decode(chunk.value))); }
  expect(events.at(-1)).toEqual({ type: 'done' });
  expect(events.some(event => event.type === 'error' && event.source === 'youtube')).toBe(true);
});
