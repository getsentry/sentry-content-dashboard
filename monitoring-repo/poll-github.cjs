const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac, randomUUID } = require('node:crypto');

async function runOnce(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const stateFile = options.stateFile || process.env.POLL_STATE_FILE || path.join(__dirname, 'last-processed-sha.json');
  const secret = options.secret || process.env.GITHUB_WEBHOOK_SECRET;
  const webhookUrl = options.webhookUrl || process.env.WEBHOOK_URL;
  const token = options.token || process.env.GITHUB_TOKEN;
  if (!secret || !webhookUrl) throw new Error('GITHUB_WEBHOOK_SECRET and WEBHOOK_URL are required');
  const persist = async state => {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2));
      await fs.rename(temporary, stateFile);
    } finally { await fs.rm(temporary, { force: true }); }
  };
  let lastSha;
  let initialPending;
  try {
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    lastSha = state.lastProcessedSha;
    initialPending = state.pending;
    if (initialPending !== undefined) {
      if (!Array.isArray(initialPending) || !initialPending.length || initialPending.some(sha => !/^[a-f0-9]{40}$/i.test(sha))) throw new Error('Invalid pending checkpoint');
    } else if (!/^[a-f0-9]{40}$/i.test(lastSha)) throw new Error('Invalid polling checkpoint');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const pending = initialPending || [];
  let ref = 'master';
  let found = !lastSha;
  for (let page = 1; page <= 100 && !initialPending; page++) {
    const response = await fetchImpl(`https://api.github.com/repos/getsentry/sentry-docs/commits?sha=${ref}&per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub commit listing failed: ${response.status}`);
    const commits = await response.json();
    if (!Array.isArray(commits) || commits.some(commit => !/^[a-f0-9]{40}$/i.test(commit.sha))) throw new Error('Invalid GitHub commit listing');
    if (page === 1 && commits.length) ref = commits[0].sha;
    for (const commit of commits) {
      if (commit.sha === lastSha) { found = true; break; }
      pending.push(commit.sha);
      if (!lastSha && pending.length === 10) break;
    }
    if (found || commits.length < 100) break;
  }
  if (!found) throw new Error('Saved checkpoint not found in GitHub history; reconcile it before retrying');
  if (!lastSha && !initialPending && pending.length) await persist({ pending });
  // Deliver oldest first. The server retrieves authoritative commit details and skips non-doc changes.
  for (const sha of pending.reverse()) {
    const body = JSON.stringify({ ref: 'refs/heads/master', repository: { full_name: 'getsentry/sentry-docs' }, commits: [{ id: sha }] });
    const response = await fetchImpl(webhookUrl, {
      method: 'POST', body, signal: AbortSignal.timeout(120000),
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
    });
    if (!response.ok) throw new Error(`Webhook delivery failed: ${response.status}; checkpoint retained for retry`);
    await persist({ lastProcessedSha: sha });
  }
  return pending.length;
}

module.exports = { runOnce };
if (require.main === module) runOnce().then(count => console.log(`Delivered ${count} commits`)).catch(error => { console.error(error.message); process.exitCode = 1; });
