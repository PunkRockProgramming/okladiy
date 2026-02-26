# okladiy

OKC + Tulsa indie/DIY show aggregator. Scrapes venue sites → `docs/shows.json` → static calendar at `docs/index.html`.

Hosted on GitHub Pages from the `docs/` directory. Updated daily via GitHub Actions.

## Local dev

```bash
npm install
npx playwright install --with-deps chromium   # one-time, for 89thstreet.js
node scraper/index.js                         # scrape all venues → docs/shows.json
npm run serve                                 # preview at http://localhost:3000
```

## Adding a venue

1. Create `scraper/scrapers/myvenue.js` — export `async function scrape()` returning an array of shows
2. Import and add to `SCRAPERS` in `scraper/index.js`
3. Run `node scraper/index.js` and verify `✓ myvenue: N shows`

Use `normalizeShow()` from `utils.js` on every item to ensure consistent shape.

## Show schema

```js
{
  title:       "Title | Support",
  venue:       "The Vanguard",
  venueUrl:    "https://www.thevanguardtulsa.com",
  date:        "2026-03-14",   // ISO 8601
  time:        "8:00 PM",
  price:       "$15",
  description: "performer1, performer2",
  eventUrl:    "https://...",
  ageLimit:    "21+",
  tags:        []
}
```

## Venues

| File | Venue | City | Platform |
|------|-------|------|----------|
| `89thstreet.js`     | 89th Street OKC        | OKC   | Wix (Playwright) |
| `opolis.js`         | Opolis                 | OKC   | Squarespace |
| `towertheater.js`   | Tower Theatre          | OKC   | Prekindle JSON-LD |
| `diamondballroom.js`| Diamond Ballroom       | OKC   | WP sitemap + JSON-LD |
| `beercity.js`       | Beer City Music Hall   | OKC   | Prekindle JSON-LD + HTML |
| `mercurylounge.js`  | Mercury Lounge         | Tulsa | Prekindle widget |
| `whittierbar.js`    | The Whittier Bar       | Tulsa | Prekindle JSON-LD |
| `noisetown.js`      | Noise Town             | Tulsa | Squarespace |
| `vanguard.js`       | The Vanguard           | Tulsa | Webflow |

## Deployment

The `.github/workflows/scrape.yml` workflow runs daily, commits an updated `docs/shows.json`, and pushes to main. GitHub Pages serves the `docs/` directory.

To enable:
1. Push this repo to GitHub
2. Go to **Settings → Pages** → Source: `Deploy from branch`, Branch: `main`, Folder: `/docs`
3. The workflow runs automatically on schedule, or trigger it manually from the **Actions** tab
