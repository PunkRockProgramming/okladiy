# okladiy — Claude Project Context

Static site + Node.js scraper that aggregates OKC and Tulsa show listings.
Scraper writes `docs/shows.json`; frontend reads it at load time.
Hosted on GitHub Pages / Netlify from the `docs/` folder.

## Key Files

| File | Purpose |
|------|---------|
| `scraper/index.js` | Entry point — runs all scrapers, merges, deduplicates, writes shows.json |
| `scraper/utils.js` | `fetchHtml`, `parseDate`, `normalizePrice`, `dedup`, `normalizeShow` |
| `scraper/scrapers/*.js` | One file per venue, each exports `scrape()` |
| `scraper/run-one.js` | Debug: run a single scraper by name |
| `docs/index.html` | Self-contained frontend (no build step) |
| `docs/shows.json` | Committed output — regenerate with `node scraper/index.js` |
| `.github/workflows/scrape.yml` | Daily cron that reruns scrapers and commits shows.json |

## Show Schema

```js
{
  title:       string,          // required
  venue:       string,          // required
  venueUrl:    string | null,   // venue homepage
  date:        "2026-03-14",    // ISO date string, no time component
  time:        string | null,   // e.g. "8:00 PM"
  price:       string | null,   // e.g. "$15", "$10–$20", "Free"
  description: string | null,   // performers, etc.
  eventUrl:    string | null,   // link to buy tickets / event page
  ageLimit:    string | null,   // "All Ages", "18+", "21+"
  tags:        string[],        // usually []
}
```

Every scraper returns `normalizeShow({...})` — never return raw objects.

## Workflow

```bash
node scraper/index.js          # regenerate shows.json (all scrapers)
node scraper/run-one.js NAME   # debug a single scraper (e.g. beercity)
npm run serve                  # local dev server (avoids CORS on file://)
```

`package.json` uses `"type": "module"` — all files must use ESM (`import`/`export`).

## Adding a New Scraper

1. Create `scraper/scrapers/VENUE.js` — export `async function scrape()`
2. Import it in `scraper/index.js` and add to the `SCRAPERS` array
3. Run `node scraper/run-one.js VENUE` to test before wiring up

## Site Patterns Reference

### Prekindle JSON-LD (Tower Theatre, Whittier Bar, Beer City)
Server-rendered. Parse `<script type="application/ld+json">` — array of MusicEvent objects.
Fields: `name`, `startDate` (ISO), `url`, `offers.{lowPrice,highPrice}`, `performer[]`.
No `time` in JSON-LD. Beer City also has HTML `.pk-eachevent` cards with `.pk-times div`
("Doors X:XXpm, Start X:XXpm") — match by normalized title to merge time in.

### Prekindle Organizer Widget (Mercury Lounge)
Not a standard Prekindle page — a widget iframe.
URL: `https://www.prekindle.com/organizer-grid-widget-main/id/24898849004906244/`
Selectors: `.pk-eachevent`, `.pk-headline`, `.pk-date-day`, `.pk-date`, `.pk-times div`
Use Cheerio (NOT Playwright).

### Squarespace (Opolis, Noise Town)
Server-rendered. Selector: `article.eventlist-event--upcoming`
- Title: `.eventlist-title-link`
- Date: `time.event-date[datetime]` attribute (ISO)
- Time: `.event-time-localized-start` text
- URL: `.eventlist-title-link[href]`
- Price: sometimes in `.eventlist-excerpt` description text

### Webflow (The Vanguard)
Server-rendered listing + batch detail fetches.
- Listing: `.ec-col-item.w-dyn-item` → title (`.title > div`), date (`.start-date > div`), href (`a.webflow-link`)
- Detail: `#event-data[data-price]`, `#event-data[data-description]`, time from `.uui-event_time-wrapper` ("Show: 8:00 pm")
- Strip "SOLD OUT | " prefix from titles
- Fetch details in parallel batches of 8

### WordPress Sitemap + JSON-LD (Diamond Ballroom)
Fetch `rhp_events-sitemap.xml` → extract event page URLs → batch-fetch each page → parse JSON-LD.
Parallel batches of 8 for speed. Do NOT use sequential fetchHtml (was 2:45 vs ~30s).

### Wix Thunderbolt / Playwright (89th Street OKC)
JS-rendered — requires Playwright. All event data in `<script id="wix-warmup-data">`.
Scrape the **homepage** (`/`), not `/events` — the events page only exposes 1 featured event.
The homepage has a widget component with all upcoming shows:
- App ID: `140603ad-af8d-84a5-2c80-a0f60cb47351`
- Find the first widget key (e.g. `widgetcomp-jdvq49ls`) with `widget.events.events[]`
- Dates: `widget.dates.events[id].startDateISOFormatNotUTC` (already local time)
- External ticket URL: `event.registration.external.registration`
- No price in warmup data — link to ticketing page instead

## Performance Notes

- Diamond Ballroom and Vanguard use parallel batch fetching (8 concurrent) — do NOT revert to sequential
- `fetchHtml()` adds a random 300–900ms delay by default; pass `{ delayMs: false }` to skip for batch sub-requests where you're managing your own rate limiting

## Gotchas

- Use `parseISOLocal()` in the frontend (not `new Date(isoStr)`) to avoid UTC offset shifting the displayed day
- `parseDate()` handles year-less formats ("Thursday, February 26") and bumps to next year if the date is in the past
- Venue in some scrapers can be plain text (no link) — always check for `<a>` before assuming a link exists
- `dedup()` keys on `venue + date + normalized title`
