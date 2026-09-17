#!/usr/bin/env node
const path = require('node:path');
const { runOnce } = require('../monitoring-repo/poll-github.cjs');
const options = { stateFile: path.join(__dirname, '../data/github-polling-state.json'), webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3000/api/github/webhook' };
async function poll() {
  try { console.log(`Delivered ${await runOnce(options)} commits`); }
  catch (error) { console.error(error.message); }
  setTimeout(poll, 60000);
}
if (require.main === module) poll();
module.exports = { runOnce, options };
