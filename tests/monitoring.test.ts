import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { runOnce } = require('../monitoring-repo/poll-github.cjs');
const { checkForNewPages } = require('../scripts/monitor-docs.js');
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'content-monitor-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const sha = (n: number) => n.toString(16).padStart(40, '0');
test('failed delivery stops in order and retains last successful checkpoint for retry', async () => {
  const stateFile = path.join(directory, 'state.json');
  await writeFile(stateFile, JSON.stringify({ lastProcessedSha: sha(0) }));
  const delivered: string[] = [];
  let fail = true;
  const fetchImpl = vi.fn(async (url: string, options: RequestInit) => {
    if (url.includes('api.github.com')) return Response.json([3, 2, 1, 0].map(n => ({ sha: sha(n) })));
    const id = JSON.parse(options.body as string).commits[0].id;
    delivered.push(id);
    return new Response('', { status: fail && id === sha(2) ? 500 : 200 });
  });
  const options = { stateFile, secret: 'test', webhookUrl: 'https://example.test/hook', fetchImpl };
  await expect(runOnce(options)).rejects.toThrow('Webhook delivery failed');
  expect(JSON.parse(await readFile(stateFile, 'utf8')).lastProcessedSha).toBe(sha(1));
  expect(delivered).toEqual([sha(1), sha(2)]);
  fail = false;
  await runOnce(options);
  expect(delivered).toEqual([sha(1), sha(2), sha(2), sha(3)]);
});
test('paginates until the checkpoint instead of dropping intermediate commits', async () => {
  const stateFile = path.join(directory, 'state.json');
  await writeFile(stateFile, JSON.stringify({ lastProcessedSha: sha(0) }));
  let pages = 0;
  let deliveries = 0;
  await runOnce({ stateFile, secret: 'test', webhookUrl: 'https://example.test/hook', fetchImpl: async (url: string) => {
    if (!url.includes('api.github.com')) { deliveries++; return new Response(''); }
    pages++;
    return Response.json((pages === 1 ? Array.from({ length: 100 }, (_, i) => 101 - i) : [1, 0]).map(n => ({ sha: sha(n) })));
  } });
  expect(pages).toBe(2); expect(deliveries).toBe(101);
});
test('sitemap records baseline even with no displayed pages and retries failed details', async () => {
  const storageFile = path.join(directory, 'docs.json');
  let pages = [{ url: 'https://docs.sentry.io/old/' }];
  const details = vi.fn().mockResolvedValue(null);
  const options = { storageFile, fetchSitemap: async () => pages, fetchPageDetails: details };
  await checkForNewPages(options);
  expect(details).not.toHaveBeenCalled();
  pages = [...pages, { url: 'https://docs.sentry.io/new/' }];
  await expect(checkForNewPages(options)).rejects.toThrow('left pending');
  details.mockImplementation(async (page: unknown) => page);
  await checkForNewPages(options);
  const state = JSON.parse(await readFile(storageFile, 'utf8'));
  expect(state.knownPages).toEqual([pages[1]]);
  expect(state.knownUrls).toHaveLength(2);
});
test('first-run failures retain the initial batch even after upstream advances', async () => {
  const stateFile = path.join(directory, 'state.json');
  let head = 10;
  const delivered: string[] = [];
  const options = { stateFile, secret: 'test', webhookUrl: 'https://example.test/hook', fetchImpl: async (url: string, options: RequestInit) => {
    if (url.includes('api.github.com')) return Response.json(Array.from({ length: head }, (_, i) => ({ sha: sha(head - i) })));
    delivered.push(JSON.parse(options.body as string).commits[0].id);
    return new Response('', { status: head === 10 ? 500 : 200 });
  } };
  await expect(runOnce(options)).rejects.toThrow();
  head = 11;
  await runOnce(options);
  expect(delivered.slice(0, 2)).toEqual([sha(1), sha(1)]);
  await runOnce(options);
  expect(delivered.at(-1)).toBe(sha(11));
});
