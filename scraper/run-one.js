/**
 * Run a single scraper by name for fast debugging.
 *
 * Usage:
 *   node scraper/run-one.js <name>
 *   node scraper/run-one.js beercity
 *   node scraper/run-one.js vanguard
 *
 * Prints each show as formatted JSON and a summary count.
 */

const name = process.argv[2];

if (!name) {
  console.error('Usage: node scraper/run-one.js <scraper-name>');
  console.error('Example: node scraper/run-one.js beercity');
  process.exit(1);
}

const modulePath = new URL(`./scrapers/${name}.js`, import.meta.url);

let scrape;
try {
  ({ scrape } = await import(modulePath));
} catch (err) {
  console.error(`Could not load scraper "${name}": ${err.message}`);
  process.exit(1);
}

console.log(`Running scraper: ${name}\n`);

try {
  const shows = await scrape();
  for (const show of shows) {
    console.log(JSON.stringify(show, null, 2));
  }
  console.log(`\n── ${shows.length} show(s) from ${name} ──`);
} catch (err) {
  console.error(`Scraper "${name}" threw an error:\n`, err);
  process.exit(1);
}
