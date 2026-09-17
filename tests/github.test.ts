import { afterEach, expect, test, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { verifyWebhookSignature } from '../src/utils/githubAuth';
const mocks = vi.hoisted(() => ({ process: vi.fn(), list: vi.fn() }));
vi.mock('../src/utils/githubProcessor', () => ({ processDocsChanges: mocks.process }));
vi.mock('@octokit/rest', () => ({ Octokit: class { rest = { repos: { listCommits: mocks.list } }; } }));
import { POST as webhook } from '../src/app/api/github/webhook/route';
import { POST as trigger } from '../src/app/api/github/trigger/route';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const sha = 'a'.repeat(40);
function request(secret: string, body = JSON.stringify({ repository: { full_name: 'getsentry/sentry-docs' }, ref: 'refs/heads/master', commits: [{ id: sha }] })) {
  return new NextRequest('http://localhost/api/github/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` } });
}
test('webhook rejects an empty configured secret and malformed signatures', async () => {
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
  expect((await webhook(request(''))).status).toBe(503);
  expect(verifyWebhookSignature('{}', 'sha256=bad', 'secret')).toBe(false);
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'real');
  expect((await webhook(request('wrong'))).status).toBe(401);
  expect(mocks.process).not.toHaveBeenCalled();
});
test('webhook propagates processing failures for retry', async () => {
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'real');
  mocks.process.mockRejectedValueOnce(Error('storage unavailable'));
  expect((await webhook(request('real'))).status).toBe(500);
});
test('manual trigger requires a bearer token and actually processes commits oldest first', async () => {
  vi.stubEnv('GITHUB_TRIGGER_SECRET', 'trigger'); vi.stubEnv('GITHUB_TOKEN', 'github');
  expect((await trigger(new NextRequest('http://localhost', { method: 'POST' }))).status).toBe(401);
  mocks.list.mockResolvedValue({ data: [{ sha: 'new' }, { sha: 'old' }] });
  mocks.process.mockResolvedValue(true);
  const response = await trigger(new NextRequest('http://localhost', { method: 'POST', headers: { authorization: 'Bearer trigger' } }));
  expect(response.status).toBe(200);
  expect(mocks.process.mock.calls).toEqual([[{ id: 'old' }], [{ id: 'new' }]]);
  expect((await response.json()).commitsProcessed).toBe(2);
});
