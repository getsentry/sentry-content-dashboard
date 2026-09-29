#!/usr/bin/env node

// Writes data/customer-stories.json: the floor of customer stories that must
// never be displayed as newly discovered. Discovery itself happens in the app
// (src/server/sources/customers.ts), so this only establishes the starting point.
//
// Re-running it adds every story currently listed to the floor, which
// permanently suppresses any the app has not discovered yet. That is why an
// existing baseline is left alone unless --force is passed.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const SENTRY_BASE_URL = process.env.SENTRY_BASE_URL || 'https://sentry.io';
const SITEMAP_URL = `${SENTRY_BASE_URL}/sitemap/sitemap-0.xml`;
const BASELINE_FILE = path.join(__dirname, '../data/customer-stories.json');

function isStoryUrl(loc) {
  let parsed;
  try { parsed = new URL(loc); } catch { return false; }
  if (parsed.origin !== new URL(SENTRY_BASE_URL).origin) return false;
  return /^\/customers\/[^/]+\/?$/.test(parsed.pathname);
}

async function fetchStoryUrls() {
  console.log('Fetching sitemap from:', SITEMAP_URL);
  const response = await axios.get(SITEMAP_URL, { timeout: 30000 });
  const $ = cheerio.load(response.data, { xmlMode: true });
  const urls = new Set();
  $('url > loc').each((i, element) => {
    const loc = $(element).text().trim();
    if (isStoryUrl(loc)) urls.add(loc);
  });
  return [...urls].sort();
}

async function seedBaseline(options = {}) {
  const file = options.baselineFile || BASELINE_FILE;
  let existing;
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  if (existing?.baselineUrls?.length && !options.force) {
    throw new Error(
      `${file} already holds ${existing.baselineUrls.length} baseline stories. ` +
      'Re-seeding suppresses any story the app has not discovered yet; pass --force to overwrite.');
  }

  const baselineUrls = await (options.fetchStoryUrls || fetchStoryUrls)();
  if (!baselineUrls.length) throw new Error('No customer stories in sitemap; baseline unchanged');

  const baseline = {
    comment: 'Baseline floor: the customer stories that existed when this source was added. ' +
      'Never displayed, and never re-surfaced as new even if runtime state is lost. ' +
      'Regenerate with `npm run seed-customers`.',
    generatedAt: new Date().toISOString(),
    baselineUrls,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(baseline, null, 2));
  fs.renameSync(temporary, file);
  console.log(`Baseline written with ${baselineUrls.length} stories; none will be displayed`);
  return baselineUrls;
}

if (require.main === module) {
  seedBaseline({ force: process.argv.includes('--force') })
    .then(() => process.exit(0))
    .catch(error => { console.error('Customer baseline seeding failed:', error.message); process.exit(1); });
}

module.exports = { seedBaseline, isStoryUrl };
