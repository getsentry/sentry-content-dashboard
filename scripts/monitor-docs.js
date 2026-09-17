#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const DOCS_BASE_URL = process.env.SENTRY_DOCS_BASE_URL || 'https://docs.sentry.io';
const SITEMAP_URL = `${DOCS_BASE_URL}/sitemap.xml`;
const STORAGE_FILE = path.join(__dirname, '../data/docs-pages.json');
const MAX_PAGES_TO_CHECK = 100; // Reasonable limit for regular monitoring

async function fetchSitemap() {
  try {
    console.log('Fetching sitemap from:', SITEMAP_URL);
    const response = await axios.get(SITEMAP_URL, { timeout: 30000 });
    const $ = cheerio.load(response.data, { xmlMode: true });
    
    const urls = [];
    $('url').each((i, element) => {
      const loc = $(element).find('loc').text();
      const lastmod = $(element).find('lastmod').text();
      
      if (loc && new URL(loc).origin === new URL(DOCS_BASE_URL).origin) {
        urls.push({
          url: loc,
          lastModified: lastmod || new Date().toISOString()
        });
      }
    });
    
    console.log(`Found ${urls.length} URLs in sitemap`);
    return urls;
  } catch (error) {
    console.error('Error fetching sitemap:', error.message);
    throw error;
  }
}

async function fetchPageDetails(page) {
  try {
    const response = await axios.get(page.url, { timeout: 10000 });
    const $ = cheerio.load(response.data);
    
    const title = $('title').text().trim() || 'Untitled';
    const description = $('meta[name="description"]').attr('content') || 
                      $('meta[property="og:description"]').attr('content') || 
                      'No description available';
    
    return {
      url: page.url,
      title: title,
      description: description,
      lastModified: page.lastModified,
      source: 'docs'
    };
  } catch (error) {
    console.warn(`Failed to fetch details for ${page.url}:`, error.message);
    return null;
  }
}

async function checkForNewPages(options = {}) {
  const storageFile = options.storageFile || STORAGE_FILE;
  let storage;
  try { storage = JSON.parse(fs.readFileSync(storageFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    storage = { knownPages: [], newPages: [] };
  }
  if (!Array.isArray(storage.knownPages)) throw new Error('Invalid docs storage');
  const sitemapUrls = await (options.fetchSitemap || fetchSitemap)();
  if (!sitemapUrls.length) throw new Error('Empty sitemap; checkpoint unchanged');
  if (storage.knownUrls !== undefined && !Array.isArray(storage.knownUrls)) throw new Error('Invalid sitemap baseline');
  const knownUrls = new Set(storage.knownUrls || storage.knownPages.map(page => page.url));
  const newPages = [];
  let failures = 0;
  if (storage.knownUrls === undefined) {
    // Baseline is separate from displayed updates, including when no updates exist yet.
    sitemapUrls.forEach(page => knownUrls.add(page.url));
  } else {
    for (const page of sitemapUrls.filter(page => !knownUrls.has(page.url)).slice(0, MAX_PAGES_TO_CHECK)) {
      const details = await (options.fetchPageDetails || fetchPageDetails)(page);
      if (details) { newPages.push(details); knownUrls.add(page.url); }
      else failures++;
    }
  }
  storage.knownPages.push(...newPages);
  storage.knownUrls = [...knownUrls];
  storage.newPages = newPages;
  storage.lastChecked = new Date().toISOString();
  fs.mkdirSync(path.dirname(storageFile), { recursive: true });
  const temporary = `${storageFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(storage, null, 2));
  fs.renameSync(temporary, storageFile);
  if (failures) throw new Error(`${failures} pages failed; left pending for retry`);
  return newPages;
}

// Main execution
if (require.main === module) {
  checkForNewPages()
    .then(() => {
      console.log('Docs monitoring completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Docs monitoring failed:', error);
      process.exit(1);
    });
}

module.exports = { checkForNewPages };
