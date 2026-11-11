import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';

export const TRACKER_URL = 'https://privacyinternational.org/examples/edtech-surveillance-tracker';
const OUTPUT_PATH = new URL('../data/facial-recognition-stories.json', import.meta.url);
const COUNTRY_PATH = new URL('../data/surveillance-schools.json', import.meta.url);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function locationKey(value) {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function safeUrl(value, base = TRACKER_URL) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function createCountryLookup(countries) {
  const lookup = new Map();
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const [countryID, country] of Object.entries(countries)) {
    if (!country || !/^[A-Z]{2}$/.test(countryID)) continue;
    for (const name of [country.name, names.of(countryID), countryID]) {
      lookup.set(locationKey(name), countryID);
    }
  }
  const aliases = {
    'United States of America': 'US', 'USA': 'US', 'UK': 'GB',
    'Russia': 'RU', 'South Korea': 'KR', 'North Korea': 'KP',
    'Vietnam': 'VN', 'Iran': 'IR', 'Taiwan': 'TW', 'Hong Kong': 'HK',
    'Turkey': 'TR', 'Kosovo': 'XK', 'Palestine': 'PS', 'Bolivia': 'BO',
    'Venezuela': 'VE', 'Tanzania': 'TZ', 'Syria': 'SY', 'Laos': 'LA'
  };
  for (const [name, countryID] of Object.entries(aliases)) {
    if (countries[countryID]) lookup.set(locationKey(name), countryID);
  }
  return lookup;
}

export function parseListing(html, pageUrl = TRACKER_URL) {
  const document = load(html);
  const storyUrls = new Map();
  document('.view-content .views-row a[href]').each((index, element) => {
    const href = safeUrl(document(element).attr('href'), pageUrl);
    if (!href) return;
    const url = new URL(href);
    const match = url.pathname.match(/^\/examples\/(\d+)\/[^/]+\/?$/);
    if (url.origin === new URL(TRACKER_URL).origin && match) {
      url.hash = '';
      url.search = '';
      storyUrls.set(match[1], url.href.replace(/\/$/, ''));
    }
  });
  if (!storyUrls.size) throw new Error(`No story listings found at ${pageUrl}`);
  const pages = new Set();
  document('.pager a[href], a[rel="next"]').each((index, element) => {
    const href = safeUrl(document(element).attr('href'), pageUrl);
    if (!href) return;
    const url = new URL(href);
    if (url.origin !== new URL(TRACKER_URL).origin ||
        url.pathname.replace(/\/$/, '') !== new URL(TRACKER_URL).pathname) return;
    const page = url.searchParams.get('page');
    if (page !== null) pages.add(`${TRACKER_URL}?page=${encodeURIComponent(page)}`);
  });
  return { storyUrls: [...storyUrls.values()], pages: [...pages] };
}

export function parseStory(html, sourceUrl, countryLookup) {
  const document = load(html);
  const tags = document('.field--name-field-type-of-abuse a[href]').map((index, element) => ({
    name: cleanText(document(element).text()),
    url: safeUrl(document(element).attr('href'), sourceUrl)
  })).get();
  if (!tags.length) throw new Error(`Missing topic tags: ${sourceUrl}`);
  if (!tags.some(tag => tag.url && new URL(tag.url).pathname.replace(/\/$/, '') === '/examples/facial-recognition')) {
    return null;
  }
  if (!tags.some(tag => tag.url && new URL(tag.url).pathname.replace(/\/$/, '') === '/examples/edtech-surveillance-tracker')) {
    throw new Error(`Missing EdTech tag: ${sourceUrl}`);
  }
  const title = cleanText(document('h1.page-title').text());
  const dateValue = document('.field--name-field-date time').attr('datetime') || '';
  const date = dateValue.slice(0, 10);
  const parsedDate = new Date(dateValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid story date: ${sourceUrl}`);
  }
  const locations = document('.field--name-field-location-region-locale a[href]').map((index, element) => {
    const name = cleanText(document(element).text());
    const url = safeUrl(document(element).attr('href'), sourceUrl);
    const countryID = countryLookup.get(locationKey(name)) || null;
    if (!url || !name) throw new Error(`Invalid location: ${sourceUrl}`);
    return { name, url, countryID };
  }).get();
  const body = document('.group-middle .field--name-body').first().clone();
  body.find('script, style, iframe').remove();
  body.find('br').replaceWith('\n');
  const articleLinks = new Map();
  const explicitLinks = body.find('a[href]').filter((index, element) =>
    /^(?:link to (?:the )?(?:article|report)|article\s*:|link\s*:)/i.test(cleanText(document(element).text())));
  const sourceLinks = explicitLinks.length ? explicitLinks : body.find('a[href]').filter((index, element) => {
    const anchor = document(element);
    return cleanText(anchor.text()) === cleanText(anchor.parent().text()) ||
      /^https?:\/\//i.test(cleanText(anchor.text())) || /^(?:link|article)\s*:/i.test(cleanText(anchor.parent().text()));
  });
  sourceLinks.each((index, element) => {
    const url = safeUrl(document(element).attr('href'), sourceUrl);
    if (url) articleLinks.set(url, { label: cleanText(document(element).text()) || 'Link to article', url });
  });
  const paragraphs = [];
  const blocks = body.find('p, li, h2, h3, blockquote');
  if (!blocks.length && cleanText(body.text())) paragraphs.push(cleanText(body.text()));
  blocks.each((index, element) => {
    const block = document(element);
    if (block.find('p, li, h2, h3, blockquote').length) return;
    const text = cleanText(block.text());
    const anchor = block.find('a').first();
    if (text && !(anchor.length && text === cleanText(anchor.text()) && safeUrl(anchor.attr('href'), sourceUrl))) {
      paragraphs.push(text);
    }
  });
  const id = new URL(sourceUrl).pathname.match(/^\/examples\/(\d+)\//)?.[1];
  if (!id || !title || !paragraphs.length) {
    throw new Error(`Incomplete story (title or body missing): ${sourceUrl}`);
  }
  return {
    id, sourceUrl, title, date, paragraphs, articleLinks: [...articleLinks.values()],
    tags, locations, countryIDs: [...new Set(locations.map(location => location.countryID).filter(Boolean))]
  };
}

export async function collectStories(fetchHtml, countryLookup) {
  const pendingPages = [TRACKER_URL];
  const visitedPages = new Set();
  const discovered = new Map();
  while (pendingPages.length) {
    const page = pendingPages.shift();
    if (visitedPages.has(page)) continue;
    if (visitedPages.size >= 100) throw new Error('Unexpected pagination: more than 100 tracker pages');
    visitedPages.add(page);
    const listing = parseListing(await fetchHtml(page), page);
    for (const url of listing.storyUrls) discovered.set(new URL(url).pathname.split('/')[2], url);
    pendingPages.push(...listing.pages.filter(url => !visitedPages.has(url)));
  }
  const stories = [];
  for (const sourceUrl of discovered.values()) {
    const story = parseStory(await fetchHtml(sourceUrl), sourceUrl, countryLookup);
    if (story) stories.push(story);
  }
  if (!stories.length) throw new Error('No facial recognition stories found; previous snapshot retained');
  stories.sort((first, second) => second.date.localeCompare(first.date) || first.id.localeCompare(second.id));
  return {
    schemaVersion: 1,
    sourceUrl: TRACKER_URL,
    fetchedAt: new Date().toISOString(),
    coverage: { listingPages: visitedPages.size, discovered: discovered.size, included: stories.length, excluded: discovered.size - stories.length },
    unlocated: stories.filter(story => !story.countryIDs.length).map(story => ({ id: story.id, sourceUrl: story.sourceUrl, title: story.title })),
    unmappedLocations: [...new Set(stories.flatMap(story => story.locations.filter(location => !location.countryID).map(location => location.name)))],
    missingArticleLinks: stories.filter(story => !story.articleLinks.length).map(story => story.sourceUrl),
    stories
  };
}

async function fetchHtml(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Geomap-FRT-story-collector/1.0' },
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      await new Promise(resolve => setTimeout(resolve, 200));
      return html;
    } catch (error) {
      if (attempt === 3) throw new Error(`Failed to fetch ${url}: ${error.message}`);
    }
  }
}

export function updateFirstExampleYears(data, stories) {
  const updated = structuredClone(data);
  const earliestYears = new Map();
  for (const story of stories) {
    const year = Number(story.date.slice(0, 4));
    for (const countryID of story.countryIDs) {
      earliestYears.set(countryID, Math.min(earliestYears.get(countryID) ?? year, year));
    }
  }
  for (const [countryID, country] of Object.entries(updated.countries ?? updated)) {
    if (!country || typeof country !== 'object') continue;
    if (String(country.surveillanceExists || '').toUpperCase() !== 'Y') {
      country.firstExampleYear = null;
    } else if (earliestYears.has(countryID)) {
      country.firstExampleYear = earliestYears.get(countryID);
    }
  }
  return updated;
}

export async function refreshStories({ countryPath = COUNTRY_PATH, outputPath = OUTPUT_PATH, fetchPage = fetchHtml } = {}) {
  const data = JSON.parse(await fs.readFile(countryPath, 'utf8'));
  const snapshot = await collectStories(fetchPage, createCountryLookup(data.countries ?? data));
  const previous = await fs.readFile(outputPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous && snapshot.stories.length < previous.stories.length) {
    throw new Error(`Story count fell from ${previous.stories.length} to ${snapshot.stories.length}; review collection before replacing snapshot`);
  }
  const previousStories = new Map((previous?.stories || []).map(story => [story.id, story]));
  const countryEntries = data.countries ?? data;
  for (const story of snapshot.stories) {
    const saved = previousStories.get(story.id);
    if (!saved || !Object.hasOwn(saved, 'regionIDs')) continue;
    if (!Array.isArray(saved.regionIDs)) {
      throw new Error(`Invalid regionIDs for story ${story.id}: expected an array`);
    }
    for (const regionID of saved.regionIDs) {
      const countryID = typeof regionID === 'string' ? regionID.slice(0, 2) : '';
      if (typeof regionID !== 'string' || !/^[A-Z]{2}-[A-Z0-9]+$/.test(regionID) ||
          !story.countryIDs.includes(countryID) ||
          !Object.hasOwn(countryEntries[countryID]?.subnational?.regions || {}, regionID)) {
        throw new Error(`Invalid regionID ${JSON.stringify(regionID)} for story ${story.id}`);
      }
    }
    story.regionIDs = [...new Set(saved.regionIDs)];
  }
  const updatedData = updateFirstExampleYears(data, snapshot.stories);
  updatedData.lastUpdated = snapshot.fetchedAt;
  const outputs = [
    { path: countryPath, data: updatedData },
    { path: outputPath, data: snapshot }
  ].map(output => ({ ...output, temporary: new URL(`${output.path.href}.tmp`) }));
  try {
    for (const output of outputs) {
      await fs.writeFile(output.temporary, `${JSON.stringify(output.data, null, 2)}\n`, 'utf8');
    }
    for (const output of outputs) {
      await fs.rename(output.temporary, output.path);
    }
  } finally {
    await Promise.all(outputs.map(output => fs.rm(output.temporary, { force: true })));
  }
  return snapshot;
}

export async function runRefresh() {
  const snapshot = await refreshStories();
  console.log(JSON.stringify(snapshot.coverage, null, 2));
  if (snapshot.unlocated.length) console.warn('Stories without location tags:', snapshot.unlocated);
  if (snapshot.unmappedLocations.length) console.warn('Location tags without a single-country match:', snapshot.unmappedLocations);
  if (snapshot.missingArticleLinks.length) console.warn('Stories without original article links:', snapshot.missingArticleLinks);
  console.log(`Saved ${snapshot.stories.length} stories across ${new Set(snapshot.stories.flatMap(story => story.countryIDs)).size} countries.`);
  console.log('Updated data/surveillance-schools.json with firstExampleYear values from the same stories.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRefresh().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}