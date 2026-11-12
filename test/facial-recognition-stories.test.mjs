import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { collectStories, createCountryLookup, parseListing, parseStory, refreshStories, safeUrl, TRACKER_URL, updateFirstExampleYears } from '../scripts/refresh-facial-recognition-stories.mjs';

const countries = createCountryLookup({ CA: { name: 'Canada' }, NZ: { name: 'New Zealand' }, CN: { name: 'China' }, US: { name: 'United States' } });
const sourceUrl = 'https://privacyinternational.org/examples/5808/proctoring-company-data-leak-raises-concerns';

function storyHtml({ facialTag = true, location = 'Canada', date = '2020-12-10T12:00:00Z' } = {}) {
  return `<h1 class="page-title">Proctoring company data leak raises concerns</h1>
    <div class="field--name-field-date"><time datetime="${date}"></time></div>
    <div class="field--name-field-location-region-locale"><a href="/location/canada">${location}</a></div>
    <div class="group-middle"><div class="field--name-body">
      <p>First paragraph &amp; text.<script>bad()</script></p><p>Second paragraph.</p>
      <p><a href="https://news.example/story">Link to article</a></p><p>Publisher: Example</p>
    </div></div>
    <div class="field--name-field-type-of-abuse">
      <a href="/examples/edtech-surveillance-tracker">EdTech: Surveillance Tracker</a>
      ${facialTag ? '<a href="/examples/facial-recognition">Facial recognition</a>' : ''}
    </div>`;
}

function listingHtml(pageLink = '') {
  return `<div class="view-content"><div class="views-row"><a href="${sourceUrl}">Title</a><a href="${sourceUrl}">Continue reading</a></div></div>${pageLink}`;
}

test('requires explicit facial recognition tag, not a title or text mention', () => {
  assert.equal(parseStory(storyHtml({ facialTag: false }).replace('Second paragraph.', 'Facial recognition.'), sourceUrl, countries), null);
  const story = parseStory(storyHtml(), sourceUrl, countries);
  assert.equal(story.id, '5808');
  assert.equal(story.date, '2020-12-10');
  assert.deepEqual(story.paragraphs, ['First paragraph & text.', 'Second paragraph.', 'Publisher: Example']);
  assert.deepEqual(story.countryIDs, ['CA']);
  assert.equal(story.articleLinks[0].url, 'https://news.example/story');
});

test('retains all country tags and maps aliases', () => {
  assert.equal(createCountryLookup({ CA: { name: 'Canada' }, XX: null }).get('canada'), 'CA');
  const html = storyHtml({ location: 'New Zealand' }).replace('</a></div>', '</a><a href="/location/china">China</a><a href="/location/us">United States of America</a></div>');
  assert.deepEqual(parseStory(html, sourceUrl, countries).countryIDs, ['NZ', 'CN', 'US']);
});

test('preserves regional tags and rejects invalid dates and unsafe original links', () => {
  const regional = parseStory(storyHtml({ location: 'Russia and Central Asia' }), sourceUrl, countries);
  assert.equal(regional.locations[0].name, 'Russia and Central Asia');
  assert.deepEqual(regional.countryIDs, []);
  assert.throws(() => parseStory(storyHtml({ date: '2020-02-31T12:00:00Z' }), sourceUrl, countries), /Invalid story date/);
  assert.deepEqual(parseStory(storyHtml().replace('https://news.example/story', 'javascript:alert(1)'), sourceUrl, countries).articleLinks, []);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,test'), null);
});

test('preserves unlocated stories without inferring a country', () => {
  const html = storyHtml().replace('<a href="/location/canada">Canada</a>', '');
  assert.deepEqual(parseStory(html, sourceUrl, countries).countryIDs, []);
});

test('article buttons exclude contextual organization links', () => {
  const html = storyHtml().replace('Second paragraph.', 'A report from <a href="https://organization.example">an organization</a>.');
  const story = parseStory(html, sourceUrl, countries);
  assert.deepEqual(story.articleLinks, [{ label: 'Link to article', url: 'https://news.example/story' }]);
  assert.ok(story.paragraphs.includes('A report from an organization.'));
  const legacy = storyHtml().replace('<p><a href="https://news.example/story">Link to article</a></p>',
    '<p>Link: <a href="https://news.example/story">Reporting title</a><br>Publication: Example</p>');
  assert.equal(parseStory(legacy, sourceUrl, countries).articleLinks[0].url, 'https://news.example/story');
});

test('discovers and deduplicates stories and follows pagination', async () => {
  const pages = new Map([
    [TRACKER_URL, listingHtml('<nav class="pager"><a href="?page=1">Next</a></nav>')],
    [`${TRACKER_URL}?page=1`, listingHtml()],
    [sourceUrl, storyHtml()]
  ]);
  const visited = [];
  const snapshot = await collectStories(async url => { visited.push(url); return pages.get(url); }, countries);
  assert.deepEqual(snapshot.coverage, { listingPages: 2, discovered: 1, included: 1, excluded: 0 });
  assert.equal(visited.filter(url => url === sourceUrl).length, 1);
  assert.throws(() => parseListing('<html>Unexpected error page</html>'), /No story listings/);
});

test('incomplete fetching fails instead of producing a partial snapshot', async () => {
  await assert.rejects(collectStories(async url => {
    if (url === TRACKER_URL) return listingHtml();
    throw new Error('Network failed');
  }, countries), /Network failed/);
});

test('timeline years use the earliest tagged story and preserve other country data', () => {
  const data = { schemaVersion: 2, countries: {
    CA: { name: 'Canada', surveillanceExists: 'Y', firstExampleYear: 2026, legalChallenge: 'N', subnational: { enabled: false } },
    CN: { name: 'China', surveillanceExists: 'Y', firstExampleYear: 2026 },
    NZ: { name: 'New Zealand', surveillanceExists: 'N', firstExampleYear: 2025 },
    AD: { name: 'Andorra', surveillanceExists: 'Y', firstExampleYear: 2018 },
    XX: null
  } };
  const stories = [
    { date: '2026-07-22', countryIDs: ['CA'] },
    { date: '2020-12-10', countryIDs: ['CA'] },
    { date: '2025-02-15', countryIDs: ['CN', 'NZ'] },
    { date: '2010-01-01', countryIDs: [] }
  ];
  const updated = updateFirstExampleYears(data, stories);
  assert.equal(updated.countries.CA.firstExampleYear, 2020);
  assert.equal(updated.countries.CN.firstExampleYear, 2025);
  assert.equal(updated.countries.NZ.firstExampleYear, null);
  assert.equal(updated.countries.AD.firstExampleYear, 2018);
  assert.equal(updated.countries.XX, null);
  assert.deepEqual(updated.countries.CA.subnational, data.countries.CA.subnational);
  assert.equal(updated.countries.CA.legalChallenge, 'N');
  assert.equal(data.countries.CA.firstExampleYear, 2026);
});

async function refreshFiles(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geomap-stories-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const countryPath = pathToFileURL(path.join(directory, 'countries.json'));
  const outputPath = pathToFileURL(path.join(directory, 'stories.json'));
  const countryText = JSON.stringify({ schemaVersion: 2, lastUpdated: '2025-01-01T00:00:00Z', countries: {
    CA: { name: 'Canada', surveillanceExists: 'Y', firstExampleYear: 2026 }
  } });
  const snapshotText = JSON.stringify({ schemaVersion: 1, stories: [{ id: 'existing' }] });
  await fs.writeFile(countryPath, countryText);
  await fs.writeFile(outputPath, snapshotText);
  return { countryPath, outputPath, countryText, snapshotText, directory };
}

test('one refresh saves new stories and timeline years from the same collection', async context => {
  const files = await refreshFiles(context);
  let fetchCount = 0;
  const result = await refreshStories({ ...files, fetchPage: async url => {
    fetchCount++;
    return url === TRACKER_URL ? listingHtml() : storyHtml();
  } });
  assert.equal(fetchCount, 2);
  assert.equal(result.stories[0].id, '5808');
  assert.equal(JSON.parse(await fs.readFile(files.outputPath, 'utf8')).stories[0].id, '5808');
  const updatedData = JSON.parse(await fs.readFile(files.countryPath, 'utf8'));
  assert.equal(updatedData.countries.CA.firstExampleYear, 2020);
  assert.equal(updatedData.lastUpdated, result.fetchedAt);
  assert.ok(Number.isFinite(Date.parse(updatedData.lastUpdated)));
  assert.notEqual(updatedData.lastUpdated, JSON.parse(files.countryText).lastUpdated);
  assert.deepEqual((await fs.readdir(files.directory)).sort(), ['countries.json', 'stories.json']);
});

test('a failed collection leaves both saved stories and country years untouched', async context => {
  const files = await refreshFiles(context);
  await assert.rejects(refreshStories({ ...files, fetchPage: async url => {
    if (url === TRACKER_URL) return listingHtml();
    throw new Error('Network failed');
  } }), /Network failed/);
  assert.equal(await fs.readFile(files.countryPath, 'utf8'), files.countryText);
  assert.equal(await fs.readFile(files.outputPath, 'utf8'), files.snapshotText);
});

test('refresh preserves manual region tags by ID while updating source fields', async context => {
  const files = await refreshFiles(context);
  const data = JSON.parse(files.countryText);
  data.countries.CA.subnational = { regions: { 'CA-NS': {}, 'CA-ON': {} } };
  await fs.writeFile(files.countryPath, JSON.stringify(data));
  for (const regionIDs of [['CA-NS', 'CA-ON', 'CA-NS'], []]) {
    await fs.writeFile(files.outputPath, JSON.stringify({ stories: [{ id: '5808', title: 'Old title', regionIDs }] }));
    const result = await refreshStories({ ...files, fetchPage: async url => url === TRACKER_URL ? listingHtml() : storyHtml() });
    assert.deepEqual(result.stories[0].regionIDs, [...new Set(regionIDs)]);
    assert.equal(result.stories[0].title, 'Proctoring company data leak raises concerns');
    assert.deepEqual(JSON.parse(await fs.readFile(files.outputPath, 'utf8')).stories[0].regionIDs, [...new Set(regionIDs)]);
  }
});

test('invalid manual region tags leave both output files untouched', async context => {
  const files = await refreshFiles(context);
  for (const regionIDs of ['CA-NS', [null], ['CA-UNKNOWN'], ['US-CA'], ['ca-ns']]) {
    const previous = JSON.stringify({ stories: [{ id: '5808', regionIDs }] });
    await fs.writeFile(files.outputPath, previous);
    await assert.rejects(refreshStories({ ...files, fetchPage: async url => url === TRACKER_URL ? listingHtml() : storyHtml() }), /Invalid regionID.*5808/);
    assert.equal(await fs.readFile(files.outputPath, 'utf8'), previous);
    assert.equal(await fs.readFile(files.countryPath, 'utf8'), files.countryText);
  }
});

test('a shrinking collection leaves both saved stories and country years untouched', async context => {
  const files = await refreshFiles(context);
  const previous = JSON.stringify({ stories: [{ id: 'first' }, { id: 'second' }] });
  await fs.writeFile(files.outputPath, previous);
  await assert.rejects(refreshStories({ ...files, fetchPage: async url => url === TRACKER_URL ? listingHtml() : storyHtml() }), /Story count fell/);
  assert.equal(await fs.readFile(files.countryPath, 'utf8'), files.countryText);
  assert.equal(await fs.readFile(files.outputPath, 'utf8'), previous);
});

const snapshot = JSON.parse(await fs.readFile(new URL('../data/facial-recognition-stories.json', import.meta.url), 'utf8'));
const pageHtml = await fs.readFile(new URL('../surveillance-schools.html', import.meta.url), 'utf8');
const renderer = await fs.readFile(new URL('../scripts/country-stories-feature.js', import.meta.url), 'utf8');
const subnationalRenderer = await fs.readFile(new URL('../scripts/subnational-map-feature.js', import.meta.url), 'utf8');

async function initializedMapPage(context, { lastUpdated = '2025-01-01T00:00:00Z', firstExampleYear = 2020, failData = false, cachedDate = null } = {}) {
  const dom = new JSDOM(pageHtml, { runScripts: 'outside-only', url: 'http://localhost:8765/surveillance-schools.html' });
  context.after(() => dom.window.close());
  const browser = dom.window;
  const requests = [];
  const errors = [];
  const intervalCallbacks = [];
  let applyCount = 0;
  browser.console.error = (...args) => errors.push(args);
  browser.console.warn = () => {};
  browser.setInterval = callback => intervalCallbacks.push(callback);
  browser.clearInterval = () => {};
  if (cachedDate) {
    browser.localStorage.setItem('surveillance_schools_rss_date', cachedDate);
    browser.localStorage.setItem('surveillance_schools_rss_date_timestamp', String(Date.now()));
    browser.localStorage.setItem('surveillance_schools_last_known_rss_date', cachedDate);
  }
  browser.fetch = async url => {
    requests.push(url);
    if (url === './data/facial-recognition-stories.json') return { ok: true, json: async () => snapshot };
    if (url === './data/surveillance-schools.json') return {
      ok: !failData,
      json: async () => ({ schemaVersion: 2, lastUpdated, countries: {
        CA: { name: 'Canada', surveillanceExists: 'Y', legalChallenge: 'N', firstExampleYear }
      } })
    };
    throw new Error('Unexpected request: ' + url);
  };
  browser.svgMap = function (options) {
    this.options = options;
    this.mapImage = browser.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.mapReset = this.moveTooltip = this.hideTooltip = () => {};
    this.applyData = () => { applyCount++; };
  };
  browser.eval(renderer);
  browser.eval(subnationalRenderer);
  const script = [...browser.document.querySelectorAll('script:not([src])')]
    .find(element => element.textContent.includes('var timelineState'));
  browser.eval(script.textContent);
  await new Promise(resolve => setImmediate(resolve));
  return { browser, requests, errors, intervalCallbacks, get applyCount() { return applyCount; } };
}

test('map startup uses JSON update date in UTC, ignores RSS caches and initializes timeline once', async context => {
  const page = await initializedMapPage(context, { cachedDate: '2030-12-31T00:00:00Z' });
  const { browser, requests, errors, intervalCallbacks } = page;
  const document = browser.document;
  assert.equal(document.getElementById('lastUpdated').textContent, 'Last updated: 1 January 2025');
  const range = document.getElementById('timelineRange');
  assert.equal(range.min, '2020');
  assert.equal(range.max, '2025');
  assert.equal(range.disabled, false);
  assert.equal(page.applyCount, 1);
  range.value = '2021';
  range.dispatchEvent(new browser.Event('input'));
  assert.equal(browser.timelineState.currentYear, 2021);
  browser.countryStoriesFeature.selectCountry('CA', 'Canada');
  document.getElementById('timelinePlayButton').click();
  assert.equal(intervalCallbacks.length, 1);
  intervalCallbacks[0]();
  intervalCallbacks[0]();
  assert.equal(browser.timelineState.currentYear, 2023);
  document.getElementById('timelinePlayButton').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, ['./data/facial-recognition-stories.json', './data/surveillance-schools.json']);
});

test('missing or invalid update metadata shows unavailable without hiding recorded timeline years', async context => {
  for (const lastUpdated of [null, '', 'not-a-date', 123, false, {}]) {
    const { browser, requests, errors } = await initializedMapPage(context, { lastUpdated, firstExampleYear: 2028 });
    assert.equal(browser.document.getElementById('lastUpdated').textContent, 'Last updated: Unavailable');
    assert.equal(browser.document.getElementById('timelineRange').max, '2028');
    assert.equal(browser.document.getElementById('timelineRange').disabled, false);
    assert.equal(browser.timelineState.currentYear, 2028);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, ['./data/facial-recognition-stories.json', './data/surveillance-schools.json']);
  }
});

test('failed map JSON loading shows unavailable without attempting RSS or proxy requests', async context => {
  const { browser, requests, errors } = await initializedMapPage(context, { failData: true });
  assert.equal(browser.document.getElementById('lastUpdated').textContent, 'Last updated: Unavailable');
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /Failed to load surveillance data JSON/);
  assert.deepEqual(requests, ['./data/facial-recognition-stories.json', './data/surveillance-schools.json']);
});

function storyPage(context, fetchSnapshot = async () => ({ ok: true, json: async () => snapshot })) {
  const dom = new JSDOM(pageHtml, { runScripts: 'outside-only', url: 'http://localhost:8080/surveillance-schools.html' });
  context.after(() => dom.window.close());
  dom.window.fetch = fetchSnapshot;
  dom.window.console.warn = () => {};
  dom.window.eval(renderer);
  const section = dom.window.document.getElementById('countryStories');
  const feature = dom.window.createCountryStoriesFeature(section);
  return { section, feature, document: dom.window.document };
}

test('story section shows the selection prompt until a country is clicked', async context => {
  const { section, feature } = storyPage(context);
  assert.equal(section.parentElement.classList.contains('has-selected-country'), false);
  assert.equal(section.hidden, false);
  assert.equal(section.querySelector('[role="status"]').hidden, true);
  assert.equal(section.querySelector('[role="status"]').textContent, '');
  await feature.load();
  feature.setYear(2026);
  assert.equal(section.parentElement.classList.contains('has-selected-country'), false);
  assert.equal(section.querySelector('[role="status"]').hidden, true);
  assert.equal(section.querySelector('[role="status"]').textContent, '');
  assert.equal(section.querySelector('h2').hidden, true);
  assert.equal(section.querySelectorAll('article').length, 0);
  assert.ok(section.parentElement.matches('.map-stories-layout'));
  assert.ok(section.previousElementSibling.matches('.map-timeline-column'));
  assert.ok(section.previousElementSibling.querySelector('#svgMapSurveillance'));
  assert.ok(section.previousElementSibling.querySelector('#timelinePanel').nextElementSibling.matches('.map-disclaimer'));
  assert.equal(section.previousElementSibling.lastElementChild.matches('.map-disclaimer'), true);
  assert.equal(section.querySelector('.contribution-hero').parentElement, section);
  assert.equal(section.tabIndex, 0);
  feature.selectCountry('CA', 'Canada');
  assert.equal(section.parentElement.classList.contains('has-selected-country'), true);
  assert.equal(section.querySelector('h2').hidden, false);
  assert.equal(section.querySelector('[role="status"]').hidden, false);
  assert.equal(section.querySelector('h2').textContent, 'Stories from Canada');
  assert.doesNotMatch(section.querySelector('[role="status"]').textContent, /Click a country/);
});

test('dismissed stories stay closed during updates and reopen on country selection', async context => {
  let resolveFetch;
  const { section, feature } = storyPage(context, () => new Promise(resolve => { resolveFetch = resolve; }));
  const loading = feature.load();
  feature.selectCountry('CA', 'Canada');
  feature.clearSelection();
  assert.equal(section.hidden, true);
  assert.equal(section.parentElement.classList.contains('has-selected-country'), false);
  resolveFetch({ ok: true, json: async () => snapshot });
  await loading;
  feature.setYear(2020);
  assert.equal(section.hidden, true);
  assert.equal(section.parentElement.classList.contains('has-selected-country'), false);
  feature.selectCountry('CA', 'Canada');
  assert.equal(section.hidden, false);
  assert.equal(section.parentElement.classList.contains('has-selected-country'), true);
  assert.equal(section.querySelector('h2').textContent, 'Stories from Canada');
  assert.equal(section.querySelectorAll('article').length, 3);
});

test('country selection and timeline filter complete cards newest first', async context => {
  const { section, feature } = storyPage(context);
  await feature.load();
  feature.setYear(2026);
  feature.selectCountry('CA', 'Canada');
  const ids = () => [...section.querySelectorAll('article')].map(card => card.dataset.storyId);
  assert.deepEqual(ids(), ['5806', '5808', '5810', '5803']);
  const story = snapshot.stories.find(entry => entry.id === '5806');
  assert.deepEqual([...section.querySelector('article').querySelectorAll('p')].map(paragraph => paragraph.textContent), story.paragraphs);
  const anchor = section.querySelector('.country-story-button');
  assert.equal(anchor.href, story.articleLinks[0].url);
  assert.equal(anchor.target, '_blank');
  assert.equal(anchor.rel, 'noopener noreferrer');
  assert.equal(section.querySelector('.country-story-source'), null);
  assert.doesNotMatch(section.textContent, /Source: Privacy International/);
  assert.equal(section.querySelectorAll('article a:not(.country-story-button)').length, 0);
  assert.equal(section.querySelector('time').dateTime, '2026-07-22');
  feature.setYear(2025);
  assert.deepEqual(ids(), ['5808', '5810', '5803']);
  feature.setYear(2020);
  assert.equal(ids().length, 3);
  feature.setYear(2019);
  assert.equal(ids().length, 0);
  assert.match(section.querySelector('[role="status"]').textContent, /Canada through 2019/);
  section.scrollTop = 150;
  feature.selectCountry('AD', 'Andorra');
  assert.equal(section.scrollTop, 0);
  assert.match(section.querySelector('[role="status"]').textContent, /No facial-recognition-tagged stories are recorded for Andorra\./);
});

test('multi-country stories appear in each tagged country and do not duplicate on rerender', async context => {
  const { section, feature } = storyPage(context);
  await feature.load();
  feature.setYear(2025);
  for (const countryID of ['NZ', 'CN']) {
    feature.selectCountry(countryID, countryID);
    assert.equal(section.querySelectorAll('[data-story-id="5826"]').length, 1);
    feature.setYear(2026);
    assert.equal(section.querySelectorAll('[data-story-id="5826"]').length, 1);
    feature.setYear(2025);
  }
  feature.setYear(2024);
  assert.equal(section.querySelectorAll('[data-story-id="5826"]').length, 0);
});

test('country and year chosen during loading win over earlier selections', async context => {
  let resolveFetch;
  const { section, feature } = storyPage(context, () => new Promise(resolve => { resolveFetch = resolve; }));
  const loading = feature.load();
  feature.selectCountry('CN', 'China');
  feature.selectCountry('CA', 'Canada');
  feature.setYear(2020);
  assert.equal(section.querySelector('[role="status"]').textContent, 'Loading stories...');
  resolveFetch({ ok: true, json: async () => snapshot });
  await loading;
  assert.equal(section.querySelector('h2').textContent, 'Stories from Canada');
  assert.equal(section.querySelectorAll('article').length, 3);
});

test('load failures expose a retry and recover without losing selection', async context => {
  let attempts = 0;
  const { section, feature } = storyPage(context, async () => {
    attempts++;
    if (attempts === 1) throw new Error('Offline');
    return { ok: true, json: async () => snapshot };
  });
  feature.selectCountry('CA', 'Canada');
  await feature.load();
  assert.equal(section.querySelector('button').hidden, false);
  assert.match(section.querySelector('[role="status"]').textContent, /could not be loaded/);
  section.querySelector('button').click();
  await feature.load();
  assert.equal(section.querySelector('button').hidden, true);
  assert.equal(section.querySelectorAll('article').length, 4);
});

test('source text is rendered literally and unsafe links reject the snapshot', async context => {
  const payload = structuredClone(snapshot);
  payload.stories[0].title = '<img src=x onerror=alert(1)>';
  const { section, feature } = storyPage(context, async () => ({ ok: true, json: async () => payload }));
  await feature.load();
  feature.selectCountry(payload.stories[0].countryIDs[0], 'Country');
  assert.equal(section.querySelector('h3').textContent, payload.stories[0].title);
  assert.equal(section.querySelector('img'), null);
  payload.stories[0].articleLinks[0].url = 'javascript:alert(1)';
  await feature.load();
  assert.equal(section.querySelectorAll('article').length, 0);
  assert.equal(section.querySelector('button').hidden, false);
});

test('country and state tooltips omit the tracker link but retain status and controls', async context => {
  const dom = new JSDOM(pageHtml, { runScripts: 'outside-only' });
  context.after(() => dom.window.close());
  dom.window.eval(await fs.readFile(new URL('../scripts/subnational-map-feature.js', import.meta.url), 'utf8'));
  const feature = dom.window.createSubnationalMapFeature({ getBaseValues: () => ({}) });
  for (const subjectLabel of ['Country', 'State']) {
    const tooltip = dom.window.document.createElement('div');
    tooltip.innerHTML = feature.createTooltipMarkup({
      subjectLabel,
      entityName: 'Example',
      surveillanceExists: 'Y',
      legalChallenge: 'Y',
      trackerLink: 'https://privacyinternational.org/examples/edtech-surveillance-tracker',
      extraButtonHtml: '<button>View state-by-state map</button>'
    });
    assert.equal(tooltip.querySelector('a'), null);
    assert.doesNotMatch(tooltip.textContent, /Open PI News Tracker/);
    assert.match(tooltip.textContent, /Has facial recognition been deployed:Yes/);
    assert.match(tooltip.textContent, /Legal action initiated:Yes/);
    assert.equal(tooltip.querySelector('button').textContent, 'View state-by-state map');
  }
});

test('shared story views filter explicit region tags independently and respect the year', async context => {
  const payload = structuredClone(snapshot);
  const tagged = payload.stories.find(story => story.countryIDs.includes('US'));
  tagged.regionIDs = ['US-CA', 'US-NY', 'US-CA'];
  let fetchCount = 0;
  const { feature, document } = storyPage(context, async () => {
    fetchCount++;
    return { ok: true, json: async () => payload };
  });
  const store = document.defaultView.createCountryStoriesStore();
  const country = document.defaultView.createCountryStoriesFeature(document.getElementById('countryStories'), { store });
  const section = document.getElementById('subnationalStories');
  const region = document.defaultView.createCountryStoriesFeature(section, { store, regionView: true });
  country.selectCountry('US', 'United States');
  region.selectRegion('US', 'US-CA', 'California');
  await Promise.all([country.load(), region.load()]);
  assert.equal(fetchCount, 1);
  assert.equal(section.querySelector('h2').textContent, 'Stories from California');
  assert.deepEqual([...section.querySelectorAll('article')].map(card => card.dataset.storyId), [tagged.id]);
  assert.ok(document.getElementById('countryStories').querySelectorAll('article').length > 1);
  region.selectRegion('US', 'US-NY', 'New York');
  assert.equal(section.querySelectorAll('article').length, 1);
  region.setYear(Number(tagged.date.slice(0, 4)) - 1);
  assert.equal(section.querySelectorAll('article').length, 0);
  assert.match(section.querySelector('[role="status"]').textContent, /New York through/);
  region.setYear(null);
  region.selectRegion('BR', 'BR-SP', 'São Paulo');
  assert.equal(section.querySelectorAll('article').length, 0);
  assert.match(section.querySelector('[role="status"]').textContent, /No stories have been tagged/);
  region.clearSelection();
  region.setYear(2026);
  assert.equal(section.querySelector('[role="status"]').textContent, 'No state selected.');
  assert.equal(section.parentElement.classList.contains('has-selected-country'), false);
  feature.clearSelection();
});

test('region loading, shared retry and invalid tags preserve the current selection', async context => {
  const payload = structuredClone(snapshot);
  const tagged = payload.stories.find(story => story.countryIDs.includes('US'));
  tagged.regionIDs = ['US-CA'];
  let resolveFetch;
  let attempts = 0;
  const { document } = storyPage(context, () => {
    attempts++;
    if (attempts === 1) return Promise.reject(new Error('Offline'));
    return new Promise(resolve => { resolveFetch = resolve; });
  });
  const store = document.defaultView.createCountryStoriesStore();
  const section = document.getElementById('subnationalStories');
  const region = document.defaultView.createCountryStoriesFeature(section, { store, regionView: true });
  region.selectRegion('US', 'US-NY', 'New York');
  await region.load();
  assert.equal(section.querySelector('button').hidden, false);
  section.querySelector('button').click();
  const loading = region.load();
  region.selectRegion('US', 'US-CA', 'California');
  resolveFetch({ ok: true, json: async () => payload });
  await loading;
  assert.equal(attempts, 2);
  assert.equal(section.querySelectorAll('article').length, 1);
  tagged.regionIDs = ['BR-SP'];
  const invalid = region.load();
  resolveFetch({ ok: true, json: async () => payload });
  await invalid;
  assert.equal(section.querySelector('button').hidden, false);
  assert.equal(section.querySelectorAll('article').length, 0);
});

test('Brazil GeoJSON selections update the stories panel from the topmost state path', async context => {
  const story = snapshot.stories.find(entry => entry.countryIDs.includes('BR'));
  const payload = { schemaVersion: 1, stories: [
    { ...story, id: 'brazil-sp', date: '2020-01-01', regionIDs: ['BR-SP'] },
    { ...story, id: 'brazil-pr', date: '2022-01-01', regionIDs: ['BR-PR'] }
  ] };
  const { document } = storyPage(context, async () => ({ ok: true, json: async () => payload }));
  const browser = document.defaultView;
  const section = document.getElementById('subnationalStories');
  const stories = browser.createCountryStoriesFeature(section, { regionView: true });
  await stories.load();
  stories.setYear(2022);
  browser.eval(subnationalRenderer);
  const regions = { 'BR-SP': { name: 'São Paulo' }, 'BR-PR': { name: 'Paraná' }, 'BR-AC': { name: 'Acre' } };
  browser.fetch = async () => ({ ok: true, json: async () => ({ features: Object.keys(regions).map(regionID => ({
    properties: { sigla: regionID.slice(3) },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
  })) }) });
  const map = browser.createSubnationalMapFeature({
    getBaseValues: () => ({ BR: { name: 'Brazil', subnational: {
      enabled: true, map: { format: 'geojson', url: '/br.json', regionCodeProperty: 'sigla', regionCodePrefix: 'BR-' }, regions
    } } }),
    onRegionSelect: stories.selectRegion,
    onRegionClear: stories.clearSelection
  });
  map.openSubnationalModal('BR');
  await new Promise(resolve => setImmediate(resolve));
  const stage = document.getElementById('subnationalMapStage');
  const topmostPath = regionID => [...stage.querySelectorAll('[data-region-code="' + regionID + '"]')].at(-1);
  const ids = () => [...section.querySelectorAll('article')].map(card => card.dataset.storyId);
  topmostPath('BR-SP').dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
  assert.equal(section.querySelector('h2').textContent, 'Stories from São Paulo');
  assert.deepEqual(ids(), ['brazil-sp']);
  assert.equal(stage.querySelectorAll('path').length, 3);
  const parana = topmostPath('BR-PR');
  parana.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 });
  for (const key of ['Enter', ' ']) {
    parana.dispatchEvent(new browser.KeyboardEvent('keydown', { key, bubbles: true }));
    assert.equal(section.querySelector('h2').textContent, 'Stories from Paraná');
    assert.deepEqual(ids(), ['brazil-pr']);
  }
  assert.equal(topmostPath('BR-SP').classList.contains('subnational-active'), false);
  assert.equal(parana.classList.contains('subnational-active'), true);
  stories.setYear(2021);
  assert.deepEqual(ids(), []);
  assert.match(section.querySelector('[role="status"]').textContent, /through 2021/);
  topmostPath('BR-AC').dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
  assert.equal(section.querySelector('[role="status"]').textContent, 'No stories have been tagged for Acre yet.');
  stage.querySelector('svg').dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
  assert.equal(section.querySelector('[role="status"]').textContent, 'No state selected.');
  assert.equal(stage.querySelector('.subnational-active'), null);
  topmostPath('BR-SP').dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
  document.getElementById('subnationalModalCloseButton').click();
  assert.equal(section.querySelector('[role="status"]').textContent, 'No state selected.');
  assert.deepEqual(ids(), []);
});

test('SVG and GeoJSON state selections support keyboard, clearing and stale-load protection', async context => {
  const { document } = storyPage(context);
  const browser = document.defaultView;
  browser.eval(await fs.readFile(new URL('../scripts/subnational-map-feature.js', import.meta.url), 'utf8'));
  const baseValues = {
    US: { name: 'United States', subnational: { enabled: true, map: { format: 'svg', url: '/us.svg', regionCodeProperty: 'postal', regionCodePrefix: 'US-' }, regions: { 'US-CA': { name: 'California' } } } },
    BR: { name: 'Brazil', subnational: { enabled: true, map: { format: 'geojson', url: '/br.json', regionCodeProperty: 'sigla', regionCodePrefix: 'BR-' }, regions: { 'BR-SP': { name: 'São Paulo' } } } }
  };
  let resolveMap;
  browser.fetch = () => new Promise(resolve => { resolveMap = resolve; });
  const selected = [];
  let cleared = 0;
  const map = browser.createSubnationalMapFeature({ getBaseValues: () => baseValues, onRegionSelect: (...args) => selected.push(args), onRegionClear: () => cleared++ });
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
  const svgResponse = { ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path postal="CA" d="M0 0 L100 0 L100 100 Z"/></svg>' };
  map.openSubnationalModal('US');
  document.getElementById('subnationalModalCloseButton').click();
  resolveMap(svgResponse);
  await flush();
  assert.equal(document.querySelector('#subnationalMapStage path'), null);
  map.openSubnationalModal('US');
  const path = document.querySelector('#subnationalMapStage path');
  path.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 });
  for (const key of ['Enter', ' ']) path.dispatchEvent(new browser.KeyboardEvent('keydown', { key, bubbles: true }));
  path.dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(selected, Array.from({ length: 3 }, () => ['US', 'US-CA', 'California']));
  assert.ok(path.classList.contains('subnational-active'));
  document.querySelector('#subnationalMapStage svg').dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
  assert.equal(path.classList.contains('subnational-active'), false);
  assert.equal(cleared, 4);
  map.openSubnationalModal('BR');
  resolveMap({ ok: true, json: async () => ({ features: [{ properties: { sigla: 'SP' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] }) });
  await flush();
  document.querySelector('#subnationalMapStage path').dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(selected.at(-1), ['BR', 'BR-SP', 'São Paulo']);
  document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.getElementById('subnationalModal').hidden, true);
});