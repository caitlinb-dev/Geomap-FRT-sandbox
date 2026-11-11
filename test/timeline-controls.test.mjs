import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

const html = await fs.readFile(new URL('../surveillance-schools.html', import.meta.url), 'utf8');

async function setup(context, startYear = 2020) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  context.after(() => dom.window.close());
  const { window } = dom;
  const document = window.document;
  const storyYears = [];
  const mapYears = [];
  const timers = new Map();
  let nextTimer = 0;
  let panelWidth = 1000;
  let resized;
  window.fetch = () => new Promise(() => {});
  window.createCountryStoriesStore = () => ({});
  window.createCountryStoriesFeature = () => ({ load() {}, setYear(year) { storyYears.push(year); } });
  window.createSubnationalMapFeature = () => ({});
  window.setInterval = callback => { timers.set(++nextTimer, callback); return nextTimer; };
  window.clearInterval = timer => timers.delete(timer);
  window.ResizeObserver = class {
    constructor(callback) { resized = callback; }
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(document.getElementById('timelinePanel'), 'clientWidth', { get: () => panelWidth });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: this.classList.contains('timeline-year-markers') ? this.children.length * 32 - 8 : 0 };
  };
  const script = Array.from(document.scripts).find(element => element.textContent.includes('var timelineState'));
  window.eval(script.textContent);
  window.getLastUpdatedYear = () => 2026;
  const values = { CA: { name: 'Canada', surveillanceExists: 'Y', firstExampleYear: startYear } };
  window.timelineState.baseValues = values;
  window.timelineState.mapInstance = { options: {}, applyData() { mapYears.push(window.timelineState.currentYear); } };
  window.initializeTimeline(values);
  await setImmediate();
  const element = id => document.getElementById(id);
  return {
    window, element, storyYears, mapYears, timers,
    tick() { for (const callback of [...timers.values()]) callback(); },
    resize(viewportWidth, width = viewportWidth) {
      window.innerWidth = viewportWidth;
      panelWidth = width;
      resized();
    }
  };
}

test('year options, arrows, dropdown and desktop slider stay synchronized', async context => {
  const { window, element, storyYears, mapYears } = await setup(context);
  const select = element('timelineYearSelect');
  assert.deepEqual(Array.from(select.options, option => option.value), ['2020', '2021', '2022', '2023', '2024', '2025', '2026']);
  assert.equal(select.value, '2026');
  assert.equal(element('timelineNextYear').disabled, true);
  element('timelinePreviousYear').click();
  assert.equal(select.value, '2025');
  assert.equal(element('timelineRange').value, '2025');
  assert.equal(element('timelineYearLabel').textContent, '2025');
  select.value = '2020';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(element('timelinePreviousYear').disabled, true);
  element('timelineNextYear').click();
  assert.equal(select.value, '2021');
  element('timelineRange').value = '2023';
  element('timelineRange').dispatchEvent(new window.Event('input'));
  assert.equal(select.value, '2023');
  window.applyTimelineYear(9999);
  assert.equal(select.value, '2026');
  window.applyTimelineYear(0);
  assert.equal(select.value, '2020');
  assert.equal(mapYears.at(-1), 2020);
  assert.deepEqual(storyYears.slice(-2), [2020, 2020]);
});

test('playback updates all controls, pauses on manual selection, stops and restarts', async context => {
  const { window, element, tick, timers } = await setup(context, 2024);
  element('timelinePlayButton').click();
  assert.equal(element('timelineYearSelect').value, '2024');
  assert.equal(element('timelinePlayButton').textContent, 'Pause');
  tick();
  assert.equal(element('timelineYearSelect').value, '2025');
  element('timelinePreviousYear').click();
  assert.equal(timers.size, 0);
  element('timelinePlayButton').click();
  const select = element('timelineYearSelect');
  select.value = '2025';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(timers.size, 0);
  element('timelinePlayButton').click();
  tick();
  assert.equal(select.value, '2026');
  assert.equal(element('timelineNextYear').disabled, true);
  assert.equal(timers.size, 0);
  assert.equal(element('timelinePlayButton').textContent, 'Play');
  element('timelinePlayButton').click();
  assert.equal(select.value, '2024');
  assert.equal(timers.size, 1);
});

test('compact mode follows viewport and panel width without resetting year, playback or focus', async context => {
  const { window, element, resize, timers } = await setup(context);
  window.applyTimelineYear(2023);
  element('timelinePlayButton').click();
  const panel = element('timelinePanel');
  assert.equal(panel.classList.contains('is-compact'), false);
  element('timelineRange').focus();
  resize(375);
  assert.equal(panel.classList.contains('is-compact'), true);
  assert.equal(window.document.activeElement.id, 'timelineYearSelect');
  assert.equal(element('timelineYearSelect').value, '2023');
  assert.equal(timers.size, 1);
  resize(1440, 200);
  assert.equal(panel.classList.contains('is-compact'), true);
  resize(1440, 1000);
  assert.equal(panel.classList.contains('is-compact'), false);
  assert.equal(window.document.activeElement.id, 'timelineRange');
  assert.equal(element('timelineRange').value, '2023');
  assert.equal(timers.size, 1);
});

test('a single-year timeline has no navigation or playback beyond its bounds', async context => {
  const { element, window, timers } = await setup(context, 2026);
  assert.equal(element('timelineYearSelect').options.length, 1);
  assert.equal(element('timelinePreviousYear').disabled, true);
  assert.equal(element('timelineNextYear').disabled, true);
  assert.equal(element('timelinePlayButton').disabled, true);
  window.toggleTimelinePlayback();
  assert.equal(timers.size, 0);
  assert.equal(element('timelineYearSelect').value, '2026');
});