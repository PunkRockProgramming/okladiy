# Scraper Agent

## Role
Runs scrapers, detects failures, and reports results. Wraps the existing scraper infrastructure with monitoring and error handling.

## Responsibilities
- Execute individual or all scrapers
- Detect and classify failures (network, selector drift, auth, empty results)
- Log run results to `db/showdb.sqlite`
- Flag anomalies: venue returning 0 shows, show count drop > 50%, new error patterns
- Report failures to PM agent

## Inputs
- Scraper name or "all"
- `scraper/scrapers/*.js` — existing scraper code
- `db/showdb.sqlite` — historical run data for comparison

## Outputs
- Shows written to `docs/shows.json` (via existing pipeline)
- Run metadata logged to `scraper_runs` table in SQLite
- Anomaly records in `anomalies` table
- Failure reports (structured JSON to stdout)

## Decision Authority
- Can RUN scrapers and LOG results
- Cannot modify scraper code
- Cannot add new venues (requires approved decision)
- Escalates persistent failures to PM

## Invocation
```bash
node agents/scraper/index.js [all|venue-name]
```
