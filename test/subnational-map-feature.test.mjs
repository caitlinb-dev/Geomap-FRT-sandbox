import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

const featureSource = await fs.readFile(new URL('../scripts/subnational-map-feature.js', import.meta.url), 'utf8');

function setup(context, format = 'svg') {
  const dom = new JSDOM(`<div id="subnationalModal" hidden>
    <div class="subnational-modal-dialog">
      <h2 id="subnationalModalTitle"></h2>
      <p id="subnationalModalDescription"></p>
      <button id="subnationalModalCloseButton">Close</button>
      <div id="subnationalMapStage"></div>
    </div>
  </div>`, { runScripts: 'outside-only' });
  context.after(() => dom.window.close());
  const { window } = dom;
  const requests = [];
  window.fetch = url => new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
  window.console.error = () => {};
  window.eval(featureSource);
  const countries = {};
  for (const [countryID, name, surveillanceExists] of [['IN', 'India', 'Y'], ['US', 'United States', 'N']]) {
    countries[countryID] = {
      name,
      subnational: {
        enabled: true,
        levelName: 'State',
        map: { url: `/${countryID}.${format}`, format, regionCodeProperty: 'id' },
        regions: { [countryID]: { name, surveillanceExists, legalChallenge: 'N' } }
      }
    };
  }
  const feature = window.createSubnationalMapFeature({ getBaseValues: () => countries });
  return {
    feature,
    requests,
    stage: window.document.getElementById('subnationalMapStage'),
    modal: window.document.getElementById('subnationalModal'),
    close: () => window.document.getElementById('subnationalModalCloseButton').click()
  };
}

function respond(request, countryID) {
  request.resolve({
    ok: true,
    text: async () => `<svg xmlns="http://www.w3.org/2000/svg"><path id="${countryID}" d="M0 0 L10 0 L10 10 Z"/></svg>`,
    json: async () => ({ features: [{
      properties: { id: countryID },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }
    }] })
  });
}

for (const format of ['svg', 'geojson']) {
  test(`late ${format} success preserves the active map and caches the response`, async context => {
    const { feature, requests, stage, close } = setup(context, format);
    feature.openSubnationalModal('IN');
    close();
    feature.openSubnationalModal('US');
    respond(requests[1], 'US');
    await setImmediate();
    const activeMap = stage.innerHTML;
    assert.equal(stage.querySelector('svg').getAttribute('aria-label'), 'United States subnational map');
    assert.equal(stage.querySelector('path').getAttribute('data-region-code'), 'US');
    assert.equal(stage.querySelector('path').style.fill, '#d4d9e0');

    respond(requests[0], 'IN');
    await setImmediate();
    assert.equal(stage.innerHTML, activeMap);

    close();
    feature.openSubnationalModal('IN');
    assert.equal(requests.length, 2);
    assert.equal(stage.querySelector('svg').getAttribute('aria-label'), 'India subnational map');
    assert.equal(stage.querySelector('path').getAttribute('data-region-code'), 'IN');
    assert.equal(stage.querySelector('path').style.fill, '#1e3283');
  });
}

test('late failure preserves the active country map', async context => {
  const { feature, requests, stage, close } = setup(context);
  feature.openSubnationalModal('IN');
  close();
  feature.openSubnationalModal('US');
  respond(requests[1], 'US');
  await setImmediate();
  const activeMap = stage.innerHTML;
  requests[0].reject(new Error('India request failed'));
  await setImmediate();
  assert.equal(stage.innerHTML, activeMap);
  assert.equal(stage.querySelector('.subnational-error'), null);
});

for (const outcome of ['success', 'failure']) {
  test(`late ${outcome} leaves the closed modal untouched`, async context => {
    const { feature, requests, stage, modal, close } = setup(context);
    feature.openSubnationalModal('IN');
    close();
    const closedContent = stage.innerHTML;
    if (outcome === 'success') {
      respond(requests[0], 'IN');
    } else {
      requests[0].reject(new Error('India request failed'));
    }
    await setImmediate();
    assert.equal(modal.hidden, true);
    assert.equal(stage.innerHTML, closedContent);
  });
}

test('failure for the active visible country still displays an error', async context => {
  const { feature, requests, stage, modal } = setup(context);
  feature.openSubnationalModal('IN');
  requests[0].resolve({ ok: false });
  await setImmediate();
  assert.equal(modal.hidden, false);
  assert.equal(stage.querySelector('.subnational-error').textContent, 'Could not load the subnational map for this country.');
});