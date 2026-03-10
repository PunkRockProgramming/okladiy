/**
 * Scraper entry point.
 *
 * Runs all venue scrapers in parallel, merges results, deduplicates,
 * validates, sorts by date, and writes docs/shows.json.
 *
 * Usage:  node scraper/index.js
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { dedup } from './utils.js';
import { validateAll } from './validate.js';
import overrides from './image-overrides.json' with { type: 'json' };

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
import { scrape as scrapeResonantHead }    from './scrapers/resonanthead.js';
import { scrape as scrapeCriterion }       from './scrapers/criterion.js';
import { scrape as scrapeSanctuary }      from './scrapers/sanctuary.js';
import { scrape as scrapeCainsBallroom } from './scrapers/cainsballroom.js';
import { scrape as scrapeTulsaTheater }  from './scrapers/tulsatheater.js';

export const SCRAPERS = [
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
  { name: 'resonanthead',   fn: scrapeResonantHead },
  { name: 'criterion',      fn: scrapeCriterion },
  { name: 'sanctuary',     fn: scrapeSanctuary },
  { name: 'cainsballroom', fn: scrapeCainsBallroom },
  { name: 'tulsatheater', fn: scrapeTulsaTheater },
];

// ── Paths ─────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'docs', 'shows.json');

// ── Image overrides ───────────────────────────────────────────────────────────

function applyImageOverrides(shows) {
  return shows.map(show => {
    const key = [show.venue, show.date, show.title]
      .map(s => (s ?? '').toLowerCase().trim()).join('||');
    const url = overrides[key];
    return url ? { ...show, imageUrl: url } : show;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function main() {
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
  const unique = applyImageOverrides(dedup(allShows)).sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  // Validate — reject malformed shows
  const { passed: validated, rejected } = validateAll(unique);
  if (rejected.length) {
    console.warn(`\n  ⚠️  Validator rejected ${rejected.length} show(s):`);
    for (const r of rejected.slice(0, 10)) {
      console.warn(`    ❌ ${r.venue} / ${r.date} / ${r.title} — ${r._rejectionReasons.join('; ')}`);
    }
  }

  // Load previous shows.json to preserve dateAdded values
  const todayISO = new Date().toISOString().slice(0, 10);
  let prevLookup = new Map();
  try {
    const prev = JSON.parse(await readFile(OUT_PATH, 'utf8'));
    for (const s of prev.shows ?? []) {
      const key = [(s.venue ?? '').toLowerCase(), s.date ?? '', (s.title ?? '').toLowerCase()].join('||');
      prevLookup.set(key, s.dateAdded ?? null);
    }
  } catch {
    // No existing file — all shows are new
  }

  // Strip _rejectionReasons from clean output, use validated shows
  const cleanShows = validated.map(({ _rejectionReasons, ...show }) => show);

  for (const show of cleanShows) {
    const key = [(show.venue ?? '').toLowerCase(), show.date ?? '', (show.title ?? '').toLowerCase()].join('||');
    if (prevLookup.has(key)) {
      show.dateAdded = prevLookup.get(key) ?? todayISO;
    } else {
      show.dateAdded = todayISO;
    }
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    scraperErrors: errors,
    shows: cleanShows,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\nWrote ${cleanShows.length} shows → ${OUT_PATH}`);
  if (errors.length) {
    console.warn(`${errors.length} scraper(s) failed — check output above.`);
  }
}

// Run main() only when executed directly
import { realpathSync } from 'fs';
const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (thisFile === entryFile) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
