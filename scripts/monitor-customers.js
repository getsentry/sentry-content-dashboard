#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const SENTRY_BASE_URL = process.env.SENTRY_BASE_URL || 'https://sentry.io';
const SITEMAP_URL = `${SENTRY_BASE_URL}/sitemap/sitemap-0.xml`;
const STORAGE_FILE = path.join(__dirname, '../data/customer-stories.json');
const MAX_STORIES_TO_CHECK = 50; // Bounds one run when several stories land at once
const MAX_STORED_STORIES = 100;

// Customer stories carry no publish date: no sitemap <lastmod>, no Last-Modified
// header, no article:published_time. So a story is dated from when this monitor
// first sees it, and the baseline below keeps the existing catalogue silent.
function isStoryUrl(loc) {
  const parsed = new URL(loc);
  if (parsed.origin !== new URL(SENTRY_BASE_URL).origin) return false;
  return /^\/customers\/[^/]+\/?$/.test(parsed.pathname);
}

async function fetchSitemap() {
  console.log('Fetching sitemap from:', SITEMAP_URL);
  const response = await axios.get(SITEMAP_URL, { timeout: 30000 });
  const $ = cheerio.load(response.data, { xmlMode: true });

  const urls = [];
  $('url').each((i, element) => {
    const loc = $(element).find('loc').text().trim();
    if (loc && isStoryUrl(loc)) urls.push({ url: loc });
  });

  console.log(`Found ${urls.length} customer stories in sitemap`);
  return urls;
}

async function fetchStoryDetails(story, discoveredAt) {
  try {
    const response = await axios.get(story.url, { timeout: 10000 });
    const $ = cheerio.load(response.data);
    const meta = name => $(`meta[property="${name}"], meta[name="${name}"]`).attr('content')?.trim();

    // og:title omits the " | Sentry" suffix the <title> carries.
    const title = meta('og:title') || $('title').text().trim().replace(/\s*\|\s*Sentry\s*$/, '') || 'Untitled';
    const description = meta('og:description') || meta('description') || '';
    const thumbnail = meta('og:image');

    return {
      url: story.url,
      title,
      description,
      publishedAt: discoveredAt,
      ...(thumbnail ? { thumbnail } : {}),
      source: 'customers',
    };
  } catch (error) {
    console.warn(`Failed to fetch details for ${story.url}:`, error.message);
    return null;
  }
}

async function checkForNewStories(options = {}) {
  const storageFile = options.storageFile || STORAGE_FILE;
  let storage;
  try { storage = JSON.parse(fs.readFileSync(storageFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    storage = { stories: [], newStories: [] };
  }
  if (!Array.isArray(storage.stories)) throw new Error('Invalid customer story storage');
  if (storage.knownUrls !== undefined && !Array.isArray(storage.knownUrls)) throw new Error('Invalid sitemap baseline');

  const sitemapUrls = await (options.fetchSitemap || fetchSitemap)();
  if (!sitemapUrls.length) throw new Error('No customer stories in sitemap; checkpoint unchanged');

  const knownUrls = new Set(storage.knownUrls || storage.stories.map(story => story.url));
  const discoveredAt = new Date().toISOString();
  const newStories = [];
  let failures = 0;

  if (storage.knownUrls === undefined) {
    // First run records the catalogue as already seen, so today's stories stay
    // hidden. Only stories that appear later are surfaced, dated on discovery.
    sitemapUrls.forEach(story => knownUrls.add(story.url));
    console.log(`Seeded baseline with ${knownUrls.size} stories; none displayed`);
  } else {
    for (const story of sitemapUrls.filter(story => !knownUrls.has(story.url)).slice(0, MAX_STORIES_TO_CHECK)) {
      const details = await (options.fetchStoryDetails || fetchStoryDetails)(story, discoveredAt);
      if (details) { newStories.push(details); knownUrls.add(story.url); }
      else failures++;
    }
    console.log(`Discovered ${newStories.length} new customer stories`);
  }

  storage.stories = [...storage.stories, ...newStories]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_STORED_STORIES);
  storage.knownUrls = [...knownUrls].sort();
  storage.newStories = newStories;
  storage.lastChecked = discoveredAt;

  fs.mkdirSync(path.dirname(storageFile), { recursive: true });
  const temporary = `${storageFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(storage, null, 2));
  fs.renameSync(temporary, storageFile);

  // Failed pages stay out of the baseline so the next run retries them.
  if (failures) throw new Error(`${failures} stories failed; left pending for retry`);
  return newStories;
}

// Main execution
if (require.main === module) {
  checkForNewStories()
    .then(() => {
      console.log('Customer story monitoring completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Customer story monitoring failed:', error.message);
      process.exit(1);
    });
}

module.exports = { checkForNewStories, isStoryUrl };
