import { expect, test, vi } from 'vitest';
import { normalizeContent, collectContent } from '../src/utils/content';
const page = { title: 'New docs', url: 'https://docs.sentry.io/new/', lastModified: '2026-09-16' };
test('normalizes static docs into the UI contract', () => {
  const [item] = normalizeContent([page], 'docs');
  expect(item.id).toBeTruthy();
  expect(item.publishedAt).toBe('2026-09-16T00:00:00.000Z');
  expect(Array.isArray(item.categories)).toBe(true);
});
test('keeps successful sources when another fails or has invalid data', async () => {
  const result = await collectContent({ blog: async () => [], docs: async () => [page], youtube: async () => { throw Error('unavailable'); }, changelog: async () => [{}] });
  expect(result.items).toHaveLength(1);
  expect(result.failedSources).toEqual(['youtube', 'changelog']);
});
vi.mock('../src/server/contentService', () => ({ refreshSource: async (source: string) => {
  if (source === 'youtube') throw new Error('Unavailable');
  return { items: source === 'docs' ? [{ title: 'Docs', url: 'https://docs.sentry.io/new/', lastModified: '2026-09-16' }] : [] };
} }));
test('export uses trusted loaders and marks partial data without outbound self-fetch', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Unexpected outbound fetch'));
  try {
    const { GET } = await import('../src/app/api/export/markdown/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Partial export. Unavailable sources: youtube');
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});
