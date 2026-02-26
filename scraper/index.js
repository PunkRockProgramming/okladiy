/**
 * Scraper entry point.
 *
 * Runs all venue scrapers in parallel, merges results, deduplicates,
 * sorts by date, and writes docs/shows.json.
 *
 * Usage:  node scraper/index.js
 */

import { writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { dedup } from './utils.js';

// ── Import scrapers ───────────────────────────────────────────────────────────
// Add new scrapers here and to the SCRAPERS array below.
// import { scrape as scrapeNolaDIY }   from './scrapers/noladiy.js'; // NOLA reference — removed
import { scrape as scrape89thStreet }   from './scrapers/89thstreet.js';
import { scrape as scrapeOpolis }          from './scrapers/opolis.js';
import { scrape as scrapeTowerTheater }    from './scrapers/towertheater.js';
import { scrape as scrapeDiamondBallroom } from './scrapers/diamondballroom.js';
import { scrape as scrapeWhittierBar }     from './scrapers/whittierbar.js';
import { scrape as scrapeNoiseTown }       from './scrapers/noisetown.js';
import { scrape as scrapeVanguard }        from './scrapers/vanguard.js';
import { scrape as scrapeMercuryLounge }   from './scrapers/mercurylounge.js';
import { scrape as scrapeBeerCity }        from './scrapers/beercity.js';

const SCRAPERS = [
  // { name: 'noladiy', fn: scrapeNolaDIY },
  { name: '89thstreet',   fn: scrape89thStreet },
  { name: 'opolis',       fn: scrapeOpolis },
  { name: 'towertheater', fn: scrapeTowerTheater },
  { name: 'diamondballroom', fn: scrapeDiamondBallroom },
  { name: 'whittierbar',    fn: scrapeWhittierBar },
  { name: 'noisetown',      fn: scrapeNoiseTown },
  { name: 'vanguard',       fn: scrapeVanguard },
  { name: 'mercurylounge',  fn: scrapeMercuryLounge },
  { name: 'beercity',       fn: scrapeBeerCity },
];

// ── Paths ─────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'docs', 'shows.json');

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Running ${SCRAPERS.length} scraper(s)…\n`);

  const results = await Promise.allSettled(SCRAPERS.map(({ fn }) => fn()));

  const allShows = [];
  const errors = [];

  for (let i = 0; i < results.length; i++) {
    const { name } = SCRAPERS[i];
    const result = results[i];

    if (result.status === 'fulfilled') {
      const shows = result.value ?? [];
      console.log(`  ✓ ${name}: ${shows.length} shows`);
      allShows.push(...shows);
    } else {
      const msg = result.reason?.message ?? String(result.reason);
      console.error(`  ✗ ${name}: ${msg}`);
      errors.push({ scraper: name, error: msg });
    }
  }

  // Dedup and sort by date ascending (nulls last)
  const unique = dedup(allShows).sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  const output = {
    lastUpdated: new Date().toISOString(),
    scraperErrors: errors,
    shows: unique,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\nWrote ${unique.length} shows → ${OUT_PATH}`);
  if (errors.length) {
    console.warn(`${errors.length} scraper(s) failed — check output above.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
