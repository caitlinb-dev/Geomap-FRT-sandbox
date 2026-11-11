import { writeFile } from 'node:fs/promises';

const SOURCE_URL = 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson';
const OUTPUT_PATH = new URL('../data/maps/in-states.svg', import.meta.url);
const WIDTH = 800;
const HEIGHT = 848;
const PADDING = 18;

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to download India boundaries: ${response.status}`);
}

const geojson = await response.json();
const features = Array.isArray(geojson.features) ? geojson.features : [];
if (features.length !== 36) {
  throw new Error(`Expected 36 India ADM1 features, received ${features.length}`);
}

function mercatorY(latitude) {
  const clampedLatitude = Math.max(-85, Math.min(85, latitude));
  const radians = clampedLatitude * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

const bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity
};

function visitCoordinates(node) {
  if (!Array.isArray(node)) {
    return;
  }

  if (typeof node[0] === 'number' && typeof node[1] === 'number') {
    const x = node[0] * Math.PI / 180;
    const y = mercatorY(node[1]);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    return;
  }

  node.forEach(visitCoordinates);
}

features.forEach((feature) => visitCoordinates(feature.geometry?.coordinates));

const scale = Math.min(
  (WIDTH - PADDING * 2) / (bounds.maxX - bounds.minX),
  (HEIGHT - PADDING * 2) / (bounds.maxY - bounds.minY)
);
const drawingWidth = (bounds.maxX - bounds.minX) * scale;
const drawingHeight = (bounds.maxY - bounds.minY) * scale;
const offsetX = (WIDTH - drawingWidth) / 2;
const offsetY = (HEIGHT - drawingHeight) / 2;

function projectPoint(point) {
  const x = point[0] * Math.PI / 180;
  const y = mercatorY(point[1]);
  return [
    ((x - bounds.minX) * scale + offsetX).toFixed(2),
    ((bounds.maxY - y) * scale + offsetY).toFixed(2)
  ];
}

function ringToPath(ring) {
  return ring.map((point, index) => {
    const [x, y] = projectPoint(point);
    return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
  }).join('') + 'Z';
}

function geometryToPath(geometry) {
  if (geometry?.type === 'Polygon') {
    return geometry.coordinates.map(ringToPath).join('');
  }

  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map(ringToPath)).join('');
  }

  throw new Error(`Unsupported geometry type: ${geometry?.type}`);
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const paths = features
  .map((feature) => {
    const shapeISO = feature.properties?.shapeISO;
    const postal = shapeISO?.replace(/^IN-/, '');
    const name = feature.properties?.shapeName;
    if (!postal || !name) {
      throw new Error('Every India boundary must have shapeISO and shapeName properties.');
    }

    return `  <path postal="${escapeAttribute(postal)}" name="${escapeAttribute(name)}" d="${geometryToPath(feature.geometry)}" />`;
  })
  .sort()
  .join('\n');

const svg = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
  '  <title>States and union territories of India</title>',
  `  <metadata>Source: geoBoundaries IND ADM1, build 2023-12-12, CC BY 2.5 IN. ${SOURCE_URL}</metadata>`,
  paths,
  '</svg>',
  ''
].join('\n');

await writeFile(OUTPUT_PATH, svg, 'utf8');
console.log(`Generated ${features.length} India regions at ${OUTPUT_PATH.pathname}`);