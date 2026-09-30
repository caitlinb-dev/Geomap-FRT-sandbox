import fs from 'node:fs/promises';

const INPUT_PATH = new URL('../data/surveillance-schools.json', import.meta.url);
const DATE_PATTERN = /\b(?:[0-2]?\d|3[0-1])\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}\b/g;

function toTrackerUrl(trackerLink) {
  const clean = String(trackerLink || '').split('#')[0];
  return clean || '';
}

function earliestYearFromHtml(htmlText) {
  if (!htmlText) {
    return null;
  }

  const dates = htmlText.match(DATE_PATTERN) || [];

  if (dates.length === 0) {
    return null;
  }

  let earliest = null;

  for (const dateText of dates) {
    const parsed = new Date(`${dateText} UTC`);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    const year = parsed.getUTCFullYear();
    if (earliest === null || year < earliest) {
      earliest = year;
    }
  }

  return earliest;
}

async function fetchEarliestYear(countryID, trackerUrl) {
  if (!trackerUrl) {
    return null;
  }

  try {
    const response = await fetch(trackerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Geomap-FRT-sandbox/1.0)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const htmlText = await response.text();
    return earliestYearFromHtml(htmlText);
  } catch (error) {
    throw new Error(`Failed to fetch earliest year for ${countryID}: ${error.message}`);
  }
}

async function main() {
  const rawInput = await fs.readFile(INPUT_PATH, 'utf8');
  const data = JSON.parse(rawInput);

  const countries = Object.entries(data.countries ?? data);

  for (const [countryID, entry] of countries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    if (String(entry.surveillanceExists || '').toUpperCase() !== 'Y') {
      entry.firstExampleYear = null;
      continue;
    }

    const trackerUrl = toTrackerUrl(entry.trackerLink);
    const earliestYear = await fetchEarliestYear(countryID, trackerUrl);
    entry.firstExampleYear = earliestYear;
    console.log(`${countryID}: ${earliestYear === null ? 'null' : earliestYear}`);
  }

  await fs.writeFile(INPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log('Updated data/surveillance-schools.json with firstExampleYear values');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
