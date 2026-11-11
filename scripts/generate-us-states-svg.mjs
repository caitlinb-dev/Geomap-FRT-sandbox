import { writeFile } from 'node:fs/promises';
import { geoAlbersUsa, geoPath } from 'd3-geo';

const SOURCE_URL = 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/USA/ADM1/geoBoundaries-USA-ADM1_simplified.geojson';
const OUTPUT_PATH = new URL('../data/maps/us-states.svg', import.meta.url);
const WIDTH = 800;
const HEIGHT = 620;
const PADDING = 18;
const STATE_CODES = new Set([
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA',
  'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS',
  'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY'
]);

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to download United States boundaries: ${response.status}`);
}

const geojson = await response.json();
const sourceFeatures = Array.isArray(geojson.features) ? geojson.features : [];

function getPostalCode(feature) {
  const shapeISO = feature.properties?.shapeISO;
  if (shapeISO === 'SU-SD') {
    return 'SD';
  }

  return shapeISO?.replace(/^US-/, '');
}

function rewindGeometry(geometry) {
  if (geometry?.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) => [...ring].reverse())
    };
  }

  if (geometry?.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => [...ring].reverse())
      )
    };
  }

  throw new Error(`Unsupported geometry type: ${geometry?.type}`);
}

const features = sourceFeatures
  .filter((feature) => STATE_CODES.has(getPostalCode(feature)))
  .map((feature) => ({
    ...feature,
    geometry: rewindGeometry(feature.geometry)
  }));
if (features.length !== STATE_CODES.size) {
  const foundCodes = new Set(features.map(getPostalCode));
  const missingCodes = [...STATE_CODES].filter((code) => !foundCodes.has(code));
  throw new Error(`Expected ${STATE_CODES.size} United States regions; missing ${missingCodes.join(', ')}`);
}

const featureCollection = {
  type: 'FeatureCollection',
  features
};
const projection = geoAlbersUsa().fitExtent(
  [[PADDING, PADDING], [WIDTH - PADDING, HEIGHT - PADDING]],
  featureCollection
);
const pathGenerator = geoPath(projection).digits(2);

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const paths = features
  .map((feature) => {
    const postal = getPostalCode(feature);
    const name = feature.properties?.shapeName;
    const pathData = pathGenerator(feature);
    if (!postal || !name || !pathData) {
      throw new Error('Every United States boundary must have a code, name, and projected path.');
    }

    return `  <path postal="${escapeAttribute(postal)}" name="${escapeAttribute(name)}" d="${pathData}" />`;
  })
  .sort()
  .join('\n');

const svg = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
  '  <title>States and District of Columbia of the United States</title>',
  `  <metadata>Source: geoBoundaries USA ADM1, Census-derived 2018 boundaries, build 2023-12-12, public domain. ${SOURCE_URL}</metadata>`,
  paths,
  '</svg>',
  ''
].join('\n');

await writeFile(OUTPUT_PATH, svg, 'utf8');
console.log(`Generated ${features.length} United States regions at ${OUTPUT_PATH.pathname}`);