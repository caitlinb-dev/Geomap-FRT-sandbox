# Geomap-FRT

Geomap-FRT is Privacy International's interactive mapping project for documenting facial recognition use in schools and related surveillance contexts.

The repository is built on top of `svgMap`, a lightweight JavaScript library for rendering interactive SVG world maps with country-level data, tooltips, links, and custom styling, originally created by Stephan Wagner.

It is designed for campaign pages, public research outputs, and geographic storytelling, while remaining usable as a general-purpose mapping library in plain HTML, ES modules, and React.

## About This Repo

This repository serves two purposes:

- it contains the `svgMap` library source and distributable bundles
- it ships Privacy International's production school surveillance map

If you are here for the campaign-facing map, start with `surveillance-schools.html`.

## Country Story Cards

Selecting a country shows facial-recognition-tagged entries from Privacy International's
[EdTech Surveillance Tracker](https://privacyinternational.org/examples/edtech-surveillance-tracker)
beside the map on wide screens, or below the timeline in windows narrower than
1000px. The desktop story column scrolls independently; smaller screens use normal
page scrolling. Before selection, the map uses the full width and the selection
prompt appears below the timeline. Cards contain the complete PI entry text, its source date,
and button-styled links to the original reporting. Only stories
dated up to the map timeline's selected year are shown, newest first.

The map loads `data/facial-recognition-stories.json` from this repository, not from PI
on each click. To refresh both the saved collection and country timeline years with
Node 22 or newer:

```bash
npm install
npm run test:stories
npm run refresh:stories
```

`npm run regen:timeline-years` runs the same combined refresh, so either command
checks for new stories and updates `firstExampleYear` in `data/surveillance-schools.json`
in one collection pass. The year is taken from each country's earliest tagged story,
not the time the script runs. Countries marked `surveillanceExists: "Y"` are updated
where matching stories exist; their existing year is retained if none are found.
Other countries keep a null timeline year, and map status flags and subnational
data are not changed.

The map's "Last updated" date comes from the top-level `lastUpdated` UTC timestamp
in `data/surveillance-schools.json`, not from a live RSS feed. Both refresh commands
set this timestamp whenever they successfully rewrite the map JSON, even if the
country values are unchanged. When editing the map JSON manually, update
`lastUpdated` too. Visitors do not trigger RSS or proxy API checks on page load or
in the background; only explicitly running a refresh command collects source pages.

Without local Node, run those commands through Docker:

```bash
docker run --rm -v "$PWD":/app -w /app node:22-bookworm sh -c 'npm install && npm run test:stories && npm run refresh:stories'
```

The refresh script follows the unfiltered tracker's pagination, deduplicates entries,
and checks the actual Facial recognition tag on each detail page. It does not depend
on PI's country or topic filters. The versioned snapshot records the collection time,
coverage counts, source tags and locations, dates, text paragraphs and article links.
Stories with multiple country tags appear under each tagged country, even where a
tag seems unexpected. Regional tags are preserved without inferring individual countries.

Review the refresh report and dataset diff before publishing. `unlocated`,
`unmappedLocations`, and `missingArticleLinks` record source-data gaps that need review.
The initial collection contains 74 matching stories from 187 entries, across 34
countries; one entry has no location, and `Russia and Central Asia` is a regional tag.
PI source URLs are retained in the dataset rather than displayed on each card. Network
or parsing failures and a decrease in total story count leave both saved datasets
untouched. Both outputs are staged before replacing either file; each replacement
is atomic. There is no scheduled refresh.

### Manually Tagging State Stories

Add an optional `regionIDs` array directly to a story object in
[data/facial-recognition-stories.json](data/facial-recognition-stories.json), alongside
its `id`, `countryIDs`, and other existing fields. For example, a US story covering
California and New York would contain these fields (keep the story's other fields):

```json
{
  "countryIDs": ["US"],
  "regionIDs": ["US-CA", "US-NY"]
}
```

Use the exact region keys under `countries.<countryID>.subnational.regions` in
[data/surveillance-schools.json](data/surveillance-schools.json). For example,
`US-CA` is California and `BR-SP` is São Paulo. Multiple regions and countries are
supported, but every region's country must already appear in the story's PI-sourced
`countryIDs`. Do not change PI country tags merely to attach a region.

Clicking a state in a configured subnational map shows explicitly tagged stories
inside the modal, newest first and only through the selected timeline year.
Omitting `regionIDs`, or setting it to `[]`, keeps a story country-level only.
Region-tagged stories still appear in the country list. A state with no tagged
stories is not evidence that facial recognition has not been deployed there.
Tags do not change map colors, deployment/legal flags, or regional timeline data.

Both refresh commands preserve `regionIDs` by stable PI story `id`, including an
explicit empty array; other source fields continue to update from PI. New stories
start without region tags. Refresh rejects malformed arrays, unknown region codes,
or regions inconsistent with the newly fetched country tags before replacing either
dataset. If validation fails, review the reported story ID and region code, correct
or remove the manual tag, and rerun the refresh. Tags are never inferred from text.

Country tags and dates come from PI, not the external publishers or collection time.
Only PI's tracker text is reproduced, not the external articles. The dataset records
PI source URLs; do not assume the repository's software license covers third-party
editorial content. Confirm applicable content permissions before republishing elsewhere.

## Highlights

- Interactive SVG world map with pan and zoom
- Country-level color visualization from your own data
- Privacy International map for tracking facial recognition in schools
- Custom tooltip rendering and click handling
- Persistent labels and static pins
- Works in plain HTML, ES modules, and React
- SCSS source included for style customization
- Small runtime surface with a single dependency: `svg-pan-zoom`

## Installation

### npm

```bash
npm install svgmap
```

```js
import svgMap from 'svgmap';
import 'svgmap/dist/svg-map.css';
```

### CDN

```html
<link href="https://cdn.jsdelivr.net/npm/svgmap@2.21.0/dist/svg-map.min.css" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/svgmap@2.21.0/dist/svg-map.umd.min.js"></script>
```

## Quick Start

```html
<div id="svgMap"></div>

<script>
  new svgMap({
    targetElementID: 'svgMap',
    data: {
      data: {
        population: {
          name: 'Population',
          format: '{0}',
          thousandSeparator: ',',
          thresholdMin: 0,
          thresholdMax: 1000000000
        }
      },
      applyData: 'population',
      values: {
        US: { population: 331002651 },
        BR: { population: 212559417 },
        DE: { population: 83240525 },
        ZA: { population: 59308690 }
      }
    }
  });
</script>
```

## Data Model

svgMap expects a dataset with:

- `data`: metric definitions
- `applyData`: the metric key used for map coloring
- `values`: country values keyed by ISO 3166-1 alpha-2 code

Example:

```js
{
  data: {
    metricA: {
      name: 'Metric A',
      format: '{0} units',
      thousandSeparator: ',',
      thresholdMin: 0,
      thresholdMax: 100
    }
  },
  applyData: 'metricA',
  values: {
    US: { metricA: 42, link: 'https://example.com' },
    FR: { metricA: 77, color: '#1357c5' }
  }
}
```

## Core Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `targetElementID` | `string` | - | Required. ID of the container element. |
| `data` | `object` | - | Required. Dataset used for coloring and tooltip content. |
| `allowInteraction` | `boolean` | `true` | Enables pan and zoom interaction. |
| `minZoom` | `number` | `1` | Minimum zoom level. |
| `maxZoom` | `number` | `25` | Maximum zoom level. |
| `initialZoom` | `number` | `1.06` | Initial zoom level. |
| `showTooltips` | `boolean` | `true` | Enables floating tooltips. |
| `tooltipTrigger` | `hover \| click` | `hover` | Tooltip activation mode. |
| `persistentTooltips` | `false \| array \| function` | `false` | Renders labels pinned to countries. |
| `staticPins` | `false \| array \| function` | `false` | Renders static markers on countries. |
| `colorMin` | `string` | `#FFE5D9` | Minimum scale color. |
| `colorMax` | `string` | `#CC0033` | Maximum scale color. |
| `colorNoData` | `string` | `#E2E2E2` | Fill color for countries without data. |
| `ratioType` | `linear \| log \| function` | `linear` | Value-to-color interpolation mode. |
| `onGetTooltip` | `function` | - | Custom tooltip renderer. |
| `onCountryClick` | `function` | - | Callback for country click events. |

Implementation details live in `src/js/core/svg-map.js`.

## Styling

Default styles are generated from SCSS and shipped in `dist/`.

- SCSS entry: `src/scss/svg-map.scss`
- Variables: `src/scss/variables.scss`
- Runtime fill color: `--svg-map-country-fill`

If you want to customize the look deeply, start from the SCSS source instead of overriding compiled CSS blindly.

## Localization

Use the `countryNames` option to replace displayed country names with your own translations.

Reference files are available in:

- `demo/html/local/`
- `demo/es6/local/`

## Featured Map

The main public-facing map in this repository is:

- `surveillance-schools.html` — Mapping Facial Recognition use in Schools

This map shows how the project supports campaign communications, country-level research, custom legend design, and targeted calls to action.

## Additional Examples

- `demo/html/` — plain HTML usage
- `demo/es6/` — ES module usage
- `demo/react/` — React integration

## Development

Install dependencies:

```bash
npm install
```

Build distributable files:

```bash
npm run build
```

Watch for changes during development:

```bash
npm run watch
```

Validate the built assets:

```bash
node test/assets.js
```

`prepublishOnly` runs the build and asset validation automatically.

## Privacy International Context

The school surveillance map is part of Privacy International's wider work on surveillance in education and facial recognition technologies.

- School surveillance map: `surveillance-schools.html`
- Campaign context: https://privacyinternational.org/campaigns/securitising-education

The repo is suitable both as a reusable map component and as a reference implementation for advocacy and research publishing.

## Project Structure

```text
src/js/core/svg-map.js    Main library class
src/js/index.js           Package entry point
src/scss/                 SCSS source for map and tooltip styles
dist/                     Built distributable bundles
demo/                     HTML, ES module, and React examples
assets/                   Helper tools for map path generation and localization
test/assets.js            Build output smoke check
```

## Attribution

- `svgMap` was originally created by Stephan Wagner
- Pan and zoom powered by `svg-pan-zoom`
- Flag assets in demos via `country-flags`

## License

MIT
