# DECISIONS.md

Decision log for OKDIY agent system. Agents propose decisions here; a human approves or rejects them. No agent proceeds on a proposal until it's marked `approved`.

---

## Schema

Each decision is an H2 section with this format:

```markdown
## DEC-XXXX: Short Title

**Status:** `proposed` | `approved` | `rejected` | `superseded`
**Proposed by:** agent name (e.g. tech-lead)
**Date proposed:** YYYY-MM-DD
**Date resolved:** YYYY-MM-DD (filled on approval/rejection)

### Context
Why this decision is needed. What problem does it solve?

### Proposal
What the agent recommends. Be specific — name the library, the approach, the tradeoffs.

### Alternatives Considered
What else was evaluated and why it was rejected.

### Decision
(Filled by human on approval. May include conditions or modifications.)

### Impact
What changes once this is approved. Which agents/files/systems are affected.
```

## Statuses

- **proposed** — Agent wrote it, waiting for human review
- **approved** — Human accepted; agents may now act on it
- **rejected** — Human declined; agents must not proceed with this approach
- **superseded** — Replaced by a later decision (link to it)

## Rules

1. Agents MUST check for an `approved` decision before starting work that requires one
2. Agents MUST NOT act on `proposed` decisions — only `approved`
3. If an agent discovers new information that changes a prior decision, it proposes a new one referencing the old DEC number
4. Decision numbers are sequential: DEC-0001, DEC-0002, etc.
5. This file is append-only for decisions. Never delete or rewrite a decision — supersede it instead.

---

<!-- Decisions below this line -->


## DEC-0001: Instagram-Only Venues: Use RSSHub Self-Hosted Instance with Manual Paste Fallback

**Status:** `approved`
**Proposed by:** tech-lead
**Date proposed:** 2026-03-10
**Date resolved:** 2026-03-10

### Context
Several OKC venues — The Sanctuary being the primary example — have no website and announce all shows exclusively via Instagram posts. These venues are completely invisible to the current scraper pipeline, which depends on structured HTML or JSON-LD from venue websites. This is a real coverage gap: The Sanctuary is an active, well-attended venue and missing it means users see an incomplete picture of the OKC scene.

The core technical challenge is that Instagram aggressively blocks programmatic access. Meta shut down the public Instagram API for third-party read access in 2018-2020, scraping instagram.com directly with Playwright or Cheerio is blocked by login walls and bot detection (Cloudflare + PerimeterX), and the official API now requires either a Business/Creator account relationship or Instagram Basic Display API (which requires OAuth from the profile owner — not viable for third-party aggregation). As of 2026, any approach that tries to act as an anonymous third party reading a public profile is operating against Instagram's platform policies and faces active countermeasures.

The show data we need is in post captions — a typical Sanctuary post reads something like "🎸 SHOW ALERT — Friday March 14 | Doors 8pm | The Sanctuary | $10 adv / $12 dos | All Ages". This is unstructured text but highly parseable with a targeted regex/NLP approach if we can reliably get the caption text. The question is entirely about the data access layer, not the parsing layer.

This decision sets a precedent for how OKDIY handles venues with no structured web presence. The recommendation must be honest about what actually works reliably in a GitHub Actions cron environment with no human in the loop, versus what requires a fallback path.

### Proposal
## Recommended Approach: RSSHub (self-hosted) as primary, Manual Paste Agent as fallback

### Tier 1 — RSSHub Self-Hosted Instance

RSSHub (`github.com/DIYgod/RSSHub`) is an open-source RSS feed generator that maintains a working Instagram route (`/instagram/user/:username`). The key word is *self-hosted*: the public `rsshub.app` instance rate-limits aggressively and its Instagram route is frequently broken due to shared IP reputation. A dedicated instance on a small VPS (Fly.io free tier, Render, or Railway — ~$0–$5/month) with a residential proxy or a dedicated Instagram session cookie has a much higher success rate.

**How it works in 2026:** RSSHub's Instagram route uses a logged-in session cookie (`instagram_session` env var) from a dedicated throwaway Instagram account. It fetches the user's feed and returns RSS XML with post captions as `<description>`. This is fragile but *maintainable* — when Instagram breaks it, RSSHub maintainers typically patch it within days and you just update your Docker image.

**Setup:**
```bash
# docker-compose.yml on your VPS
services:
  rsshub:
    image: diygod/rsshub:latest
    environment:
      - IG_USERNAME=okdiy_bot_account
      - IG_PASSWORD=xxxx
      # OR use session cookie — more stable than password login:
      - INSTAGRAM_SESSION_ID=xxxx
    ports:
      - "1200:1200"
    restart: unless-stopped
```

**New scraper: `scraper/scrapers/sanctuary.js`**
```js
import { fetchHtml } from '../utils.js';
import { XMLParser } from 'fast-xml-parser'; // add to package.json

const RSSHUB_BASE = process.env.RSSHUB_URL ?? 'http://localhost:1200';
const INSTAGRAM_USER = 'thesanctuaryokc'; // verify handle

// Regex patterns for caption parsing
const DATE_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,\s]+([a-z]+ \d{1,2}(?:,? \d{4})?)/i;
const TIME_RE = /doors?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i;
const PRICE_RE = /\$(\d+)(?:\s*(?:adv(?:ance)?|advance))?(?:\s*[\/|]\s*\$(\d+)\s*(?:dos|door))?/i;
const AGE_RE = /\b(all ages|18\+|21\+)\b/i;

function parseCaption(caption, postUrl) {
  const dateMatch = caption.match(DATE_RE);
  const timeMatch = caption.match(TIME_RE);
  const priceMatch = caption.match(PRICE_RE);
  const ageMatch = caption.match(AGE_RE);

  if (!dateMatch) return null; // not a show post, skip

  const rawDate = dateMatch[2].trim();
  const date = parseDate(rawDate); // reuse existing util — handles year-less formats
  if (!date) return null;

  let price = null;
  if (priceMatch) {
    price = priceMatch[2]
      ? `$${priceMatch[1]} adv / $${priceMatch[2]} door`
      : `$${priceMatch[1]}`;
  }

  // Title: first line of caption, strip emoji
  const title = caption.split('\n')[0].replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();

  return normalizeShow({
    title,
    venue: 'The Sanctuary',
    venueUrl: `https://www.instagram.com/${INSTAGRAM_USER}/`,
    date,
    time: timeMatch ? normalizeTime(timeMatch[1]) : null,
    price,
    description: caption.slice(0, 300),
    eventUrl: postUrl,
    ageLimit: ageMatch ? ageMatch[1] : null,
    tags: ['instagram'],
  });
}

export async function scrape() {
  const feedUrl = `${RSSHUB_BASE}/instagram/user/${INSTAGRAM_USER}`;
  const xml = await fetchHtml(feedUrl, { delayMs: false });
  const parser = new XMLParser({ ignoreAttributes: false });
  const feed = parser.parse(xml);

  const items = feed?.rss?.channel?.item ?? [];
  const shows = [];

  for (const item of items) {
    const caption = item.description ?? '';
    const postUrl = item.link ?? null;
    const show = parseCaption(caption, postUrl);
    if (show) shows.push(show);
  }

  return shows;
}
```

**Environment variables needed in `.github/workflows/scrape.yml`:**
```yaml
env:
  RSSHUB_URL: ${{ secrets.RSSHUB_URL }}
```

### Tier 2 — Manual Paste Fallback (human-in-the-loop)

When RSSHub is down or the session expires, a human can paste Instagram post text into a lightweight CLI tool that invokes a parsing agent:

```bash
node scraper/parse-ig-paste.js --venue sanctuary
# prompts for pasted caption text, outputs a normalized show object to stdout
# human reviews and appends to a `scraper/manual-shows.json` override file
```

`scraper/index.js` should merge `manual-shows.json` last (after dedup), so hand-curated entries always survive. The file is committed to the repo. This is low-tech but reliable as a safety net.

### What NOT to do

- **Do not run Playwright against instagram.com** — you will hit a login wall immediately in a headless environment without a pre-authenticated session, and maintaining that session in CI is a maintenance nightmare.
- **Do not use Instaloader in the same workflow** — it requires Python, adds a dependency language, and faces the same session management problem. It's a fine tool but not worth the complexity when RSSHub already solves the same problem in the same stack.
- **Do not use the official Instagram Graph API** — it requires The Sanctuary to grant OKDIY an OAuth token, which would require ongoing venue cooperation and re-authentication every 60 days. Not viable for a fully automated aggregator.


### Alternatives Considered
### Instaloader (Python CLI)
Instaloader (`instaloader.de`) is a mature Python tool for downloading Instagram profiles, including captions. It works, but: (1) it requires Python in the CI environment alongside Node, (2) it faces identical session cookie requirements as RSSHub, (3) it has no RSS/JSON output — you'd parse its downloaded `.txt` files — and (4) it's maintained by a single developer with slower Instagram breakage recovery than the RSSHub community. Rejected in favor of RSSHub which is already in the JavaScript ecosystem and has a larger maintenance community.

### Official Instagram Graph API / Basic Display API
Meta's official API is completely non-viable for third-party aggregation. The Graph API requires the profile owner to authorize your app and grant an access token. Basic Display API was deprecated in September 2024. Even if The Sanctuary's owner cooperated, tokens expire every 60 days and require a user to re-authenticate via a browser OAuth flow — incompatible with a fully automated daily cron. Rejected as requiring unworkable ongoing venue cooperation.

### Playwright Against instagram.com Directly
Running Playwright against `https://www.instagram.com/thesanctuaryokc/` requires a logged-in session — Instagram redirects anonymous visitors to a login page. Maintaining a Playwright session with stored auth state in GitHub Actions Secrets is theoretically possible but extremely fragile: Instagram's bot detection (PerimeterX) fingerprints headless browsers and sessions get invalidated frequently, often within hours. The maintenance burden is high and the breakage is silent (scraper returns 0 results rather than erroring clearly). Rejected — too fragile for unattended CI.

### Apify / Bright Data Instagram Scraper (paid)
Commercial scraping platforms like Apify maintain Instagram scrapers using rotating residential proxies and managed sessions. They work reliably but cost $49–$200/month for meaningful volume. OKDIY is a free, open-source community project with no budget. Rejected on cost grounds, though worth revisiting if the project ever has sponsorship.

### Manual-Only (no automation)
Fully manual curation — a volunteer copies post text weekly and runs the parse-ig-paste.js tool. This is zero-maintenance from an infrastructure standpoint but requires a committed human. It's included as the Tier 2 fallback above rather than the primary approach, because RSSHub's automation is worth attempting first. If RSSHub proves too unreliable over 30 days of real-world use, promoting manual-only to primary is a legitimate outcome.

### Polling a Public RSS Bridge (public instances)
RSS-Bridge and RSSHub both have public instances. These are free but unreliable for Instagram specifically — public IPs are heavily rate-limited by Meta, and Instagram routes on public instances are frequently broken or removed entirely. Not suitable as a dependency for a daily cron job. Self-hosting is required for any RSS-based approach to be viable.


### Decision
*(Awaiting human review)*

### Impact
**New files:**
- `scraper/scrapers/sanctuary.js` — new venue scraper using RSSHub RSS feed
- `scraper/parse-ig-paste.js` — CLI tool for manual caption → normalized show parsing
- `scraper/manual-shows.json` — committed override file for hand-curated shows (initially `[]`)

**Modified files:**
- `scraper/index.js` — import and register `sanctuary.js` in SCRAPERS array; merge `manual-shows.json` after dedup
- `.github/workflows/scrape.yml` — add `RSSHUB_URL` secret reference to env block
- `package.json` — add `fast-xml-parser` dependency (`npm install fast-xml-parser`)

**Infrastructure:**
- One new VPS service (Fly.io / Render / Railway) running RSSHub Docker container
- One new GitHub Actions Secret: `RSSHUB_URL` pointing to that service
- One throwaway Instagram account with session cookie stored as `RSSHUB_INSTAGRAM_SESSION_ID` secret

**Behavioral changes:**
- Daily scrape will now include The Sanctuary shows (when RSSHub is healthy)
- Shows scraped from Instagram will have `tags: ["instagram"]` — frontend can optionally display a small Instagram icon or caveat
- If RSSHub is down, sanctuary scraper should catch and log the error gracefully (return `[]`) rather than failing the whole pipeline — add try/catch in `scrape()` wrapping the fetch
- `manual-shows.json` entries survive dedup and appear in `shows.json` regardless of scraper health — they are the source of truth for hand-entered data

**Fragility acknowledgment:**
This scraper is inherently less reliable than HTML/JSON-LD scrapers and will break when Instagram changes its session mechanism or RSSHub's route breaks. The recommended monitoring strategy: add a check in `scraper/index.js` that warns (but does not fail) if a scraper returns 0 results, and post that warning to a GitHub Actions summary. A human can then decide whether to trigger a manual paste run.


## DEC-0002: RSSHub Instagram Scraping: Deployment Requirements, Feed Format, Failure Conditions, and PoC Test Plan for The Sanctuary OKC

**Status:** `approved`
**Proposed by:** tech-lead
**Date proposed:** 2026-03-10
**Date resolved:** 2026-03-10

### Context
DEC-0001 approved using a self-hosted RSSHub instance as the primary strategy for Instagram-only venues (e.g., The Sanctuary OKC), with a manual paste fallback. That decision established the "what" — this proposal scopes the "how" in enough detail for the scraper agent to execute immediately.

The Sanctuary OKC posts show announcements exclusively via Instagram (@thesanctuaryokc). There is no venue website, no Prekindle page, no Squarespace calendar. The only machine-readable path to their show listings is through Instagram's post content — either via the official API (requires business approval and is rate-limited to death for third parties), a headless browser scraping instagram.com (blocked aggressively, login-walled), or an intermediary RSS bridge like RSSHub that abstracts the scraping layer.

RSSHub is a self-hosted Node.js application that wraps dozens of social platforms — including Instagram — in RSS endpoints. It handles cookie-based auth, rate limit backoff, and response caching internally. The OKDIY scraper would treat the RSSHub instance as a dumb HTTP dependency: fetch a URL, get an RSS/Atom feed, parse it. This keeps the per-venue scraper thin and testable without tangling Instagram auth into the core scraper codebase.

This proposal defines: (1) minimum viable deployment of RSSHub with Instagram support, (2) the exact feed URL format to use, (3) the specific failure conditions that must trigger the manual paste fallback, and (4) a step-by-step PoC test plan the scraper agent can run immediately to validate the pipeline end-to-end before writing a single line of scraper code.

### Proposal
## 1. RSSHub Deployment Requirements for Instagram

### Core Requirements

RSSHub itself is straightforward — it's a plain Node.js/Express app. Instagram support is the hard part because Meta aggressively blocks unauthenticated scraping.

**Runtime:**
- Node.js 18+ (LTS), or Docker (recommended for isolation)
- 512MB RAM minimum; 1GB recommended if caching is enabled
- Publicly reachable URL is NOT required — `localhost` is sufficient since the OKDIY scraper runs in GitHub Actions, and RSSHub can run as a sidecar service in the same Actions job (via `docker run -d`) or on a cheap VPS/fly.io instance

**Instagram-specific configuration — the critical part:**

RSSHub's Instagram route (`/instagram/user/:id`) requires authenticated cookies from a logged-in Instagram session. Without them, it returns a 403 or empty feed immediately. You must supply:

```bash
# .env or environment variables passed to RSSHub
INSTAGRAM_USERNAME=<a dedicated burner IG account username>
INSTAGRAM_PASSWORD=<password>
# OR cookie-based auth (more reliable, avoids login flow bot detection):
INSTAGRAM_SESSION_ID=<sessionid cookie value from a logged-in browser session>
```

**Recommended: cookie-based auth** (`INSTAGRAM_SESSION_ID`). Extracting this from a browser DevTools session (Application → Cookies → `sessionid`) bypasses Meta's login-flow bot detection entirely. The session ID rotates infrequently (weeks to months) for accounts that are actively used.

**Additional recommended env vars:**
```bash
CACHE_TYPE=memory          # or 'redis' if you want persistence across restarts
CACHE_EXPIRE=3600          # cache feeds for 1 hour — Instagram rate limits ~200 req/day per session
PROXY_URI=                 # optional: residential proxy URI if Meta blocks the host IP
PORT=1200                  # RSSHub default
```

**Docker deployment (recommended for GitHub Actions sidecar):**
```bash
docker run -d \
  --name rsshub \
  -p 1200:1200 \
  -e INSTAGRAM_SESSION_ID=$INSTAGRAM_SESSION_ID \
  -e CACHE_TYPE=memory \
  -e CACHE_EXPIRE=3600 \
  diygod/rsshub:latest
```

In `.github/workflows/scrape.yml`, add this as a `services:` block or a pre-step `run:` before the scraper executes. The scraper then hits `http://localhost:1200`.

**Burner account hygiene:**
- Create a dedicated Instagram account solely for RSSHub auth — never use a personal account
- Follow The Sanctuary OKC from this account (reduces chance of session being flagged)
- Do NOT use this account for any human activity; it's a service credential
- Rotate the `INSTAGRAM_SESSION_ID` every 60 days proactively, or immediately on failure

---

## 2. RSSHub Feed URL Format for an Instagram Profile

The canonical RSSHub route for an Instagram user profile is:

```
http://localhost:1200/instagram/user/:username
```

For The Sanctuary OKC (`@thesanctuaryokc`):

```
http://localhost:1200/instagram/user/thesanctuaryokc
```

**What the feed contains (per item):**
- `<title>` — first ~100 chars of the post caption
- `<description>` — full caption text (HTML-escaped), embedded image(s)
- `<link>` — direct URL to the Instagram post (`https://www.instagram.com/p/SHORTCODE/`)
- `<pubDate>` — RFC 2822 post timestamp
- `<author>` — username

**What it does NOT contain natively:**
- Structured date/time/price fields — those must be extracted via regex from the caption text
- Event-specific metadata (this is raw social content, not a calendar)

**Feed format:** RSS 2.0 by default. To get Atom or JSON Feed, append `?format=atom` or use the RSSHub UI at `http://localhost:1200`.

---

## 3. Failure Conditions That Must Trigger the Manual Paste Fallback

The scraper for The Sanctuary OKC must treat RSSHub as an unreliable upstream and fail gracefully. Implement a `fetchSanctuaryFeed()` wrapper that catches all of the following and returns `null` (which the scraper then handles by loading the manual paste file):

| Failure Condition | Detection | Notes |
|---|---|---|
| **HTTP 4xx/5xx from RSSHub** | Response status code | Includes 403 (Instagram blocked the session), 404 (route not found), 500 (RSSHub crash) |
| **Empty feed (0 items)** | `items.length === 0` after parsing | Instagram returned no posts — could be private account, deleted account, or auth failure that RSSHub treated as empty |
| **Feed items all older than 90 days** | Compare `pubDate` of newest item to `Date.now()` | Account exists but hasn't posted — don't surface stale data as current events |
| **RSSHub unreachable / ECONNREFUSED** | Network error on fetch | Docker sidecar didn't start, or VPS is down |
| **Session expired / rate limited** | Feed returns items but description contains Instagram's "login required" HTML | Parse description for `<title>Login</title>` or `"Sorry, this page isn't available"` strings |
| **No show-like posts in feed** | Zero items pass the event-detection heuristic (see scraper logic below) | RSSHub is healthy but The Sanctuary posted no event content recently |

**Scraper logic skeleton:**
```js
// scraper/scrapers/sanctuary.js
import { fetchHtml } from '../utils.js';
import { readFileSync, existsSync } from 'fs';
import { parseRssFeed } from '../utils.js'; // to be added: thin wrapper around fast-xml-parser

const RSSHUB_URL = process.env.RSSHUB_URL ?? 'http://localhost:1200';
const MANUAL_PASTE_PATH = './scraper/data/sanctuary-manual.txt';

export async function scrape() {
  let rawItems = null;

  try {
    const feedUrl = `${RSSHUB_URL}/instagram/user/thesanctuaryokc`;
    const xml = await fetchHtml(feedUrl, { delayMs: false });
    const feed = parseRssFeed(xml); // returns { items: [{title, description, link, pubDate}] }

    if (feed.items.length === 0) throw new Error('Empty feed');

    const newestDate = new Date(feed.items[0].pubDate);
    if (Date.now() - newestDate > 90 * 24 * 60 * 60 * 1000) throw new Error('Feed is stale');

    if (feed.items[0].description?.includes("Sorry, this page isn't available")) {
      throw new Error('Instagram session expired or account private');
    }

    rawItems = feed.items;
  } catch (err) {
    console.warn(`[sanctuary] RSSHub failed (${err.message}), falling back to manual paste`);
  }

  if (!rawItems) {
    if (!existsSync(MANUAL_PASTE_PATH)) {
      console.warn('[sanctuary] No manual paste file found — skipping venue');
      return [];
    }
    rawItems = parseManualPaste(readFileSync(MANUAL_PASTE_PATH, 'utf8'));
  }

  return rawItems.flatMap(extractShows);
}
```

---

## 4. PoC Test Plan — Executable Immediately

This is a sequential checklist the scraper agent can run right now to validate the full pipeline before writing production scraper code.

### Step 1: Obtain a valid Instagram session cookie (~5 min)

1. Open a browser you don't normally use (or a new Chrome profile)
2. Navigate to `https://www.instagram.com` and log in with the burner account
3. Open DevTools → Application → Cookies → `https://www.instagram.com`
4. Copy the value of the `sessionid` cookie
5. Store it: `export INSTAGRAM_SESSION_ID="<value>"`

### Step 2: Run RSSHub locally via Docker (~2 min)

```bash
docker run -d \
  --name rsshub-poc \
  -p 1200:1200 \
  -e INSTAGRAM_SESSION_ID=$INSTAGRAM_SESSION_ID \
  -e CACHE_TYPE=memory \
  diygod/rsshub:latest

# Wait ~10 seconds for startup, then verify:
curl -s http://localhost:1200 | head -20
# Expected: RSSHub HTML index page
```

### Step 3: Fetch The Sanctuary OKC's feed (~1 min)

```bash
curl -s "http://localhost:1200/instagram/user/thesanctuaryokc" \
  | tee /tmp/sanctuary-feed.xml \
  | grep -c "<item>"
# Expected: a number > 0 (Instagram returns ~12 posts by default)
```

If you get `0` items or an error: check `docker logs rsshub-poc` — it will show the exact Instagram error (auth failure, rate limit, private account).

### Step 4: Validate feed content contains usable event data (~5 min)

```bash
# Pretty-print the first item's title + description
node -e "
import { readFileSync } from 'fs';
import { XMLParser } from 'fast-xml-parser'; // npm install fast-xml-parser
const xml = readFileSync('/tmp/sanctuary-feed.xml', 'utf8');
const parser = new XMLParser({ ignoreAttributes: false });
const feed = parser.parse(xml);
const items = feed.rss.channel.item;
const first = Array.isArray(items) ? items[0] : items;
console.log('TITLE:', first.title);
console.log('DATE:', first.pubDate);
console.log('LINK:', first.link);
console.log('DESCRIPTION SNIPPET:', String(first.description).slice(0, 500));
" --input-type=module
```

**Success criteria for PoC:**
- [ ] At least 1 `<item>` returned
- [ ] `pubDate` is within the last 90 days
- [ ] `description` contains caption text (not an Instagram login wall)
- [ ] At least 1 item caption contains a date-like string matching `/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2}/i` or a day-of-week + time pattern — this confirms event posts are parseable
- [ ] `link` resolves to a real Instagram post URL (`https://www.instagram.com/p/...`)

### Step 5: Validate failure fallback path (~2 min)

```bash
# Simulate RSSHub being down — stop the container
docker stop rsshub-poc

# Confirm scraper falls back gracefully (once sanctuary.js exists):
node scraper/run-one.js sanctuary
# Expected: "[sanctuary] RSSHub failed (ECONNREFUSED), falling back to manual paste"
# Then either empty array (no paste file yet) or manual paste results
```

### Step 6: Tear down and document session ID rotation

```bash
docker rm rsshub-poc

# Store INSTAGRAM_SESSION_ID as a GitHub Actions secret:
# Settings → Secrets → Actions → New repository secret
# Name: INSTAGRAM_SESSION_ID
# Value: <the sessionid value>
```

Add to `.github/workflows/scrape.yml`:
```yaml
- name: Start RSSHub
  run: |
    docker run -d --name rsshub -p 1200:1200 \
      -e INSTAGRAM_SESSION_ID=${{ secrets.INSTAGRAM_SESSION_ID }} \
      -e CACHE_TYPE=memory \
      diygod/rsshub:latest
    sleep 15  # wait for startup
```

---

## Summary of Decisions Made Here

| Decision | Choice |
|---|---|
| Auth method | Cookie-based `sessionid` (not username/password login flow) |
| Deployment target | Docker sidecar in GitHub Actions (no always-on VPS needed) |
| Feed URL | `http://localhost:1200/instagram/user/thesanctuaryokc` |
| Feed parser | `fast-xml-parser` (already used in ecosystem, zero deps, ESM-compatible) |
| Fallback trigger | Any of 6 enumerated failure conditions → load `sanctuary-manual.txt` |
| Session rotation | Manual every 60 days, or automated alert on failure |

### Alternatives Considered
This is an implementation-level decision within the scope of DEC-0001. The strategic alternatives (Instaloader, official API, Playwright, paid services) were already evaluated in DEC-0001 and rejected. This proposal specifies the concrete execution plan for the approved RSSHub approach — no competing alternatives at this level.

### Decision
*(Awaiting human review)*

### Impact
- Defines the exact deployment config, feed URL, and failure conditions for the Sanctuary scraper
- Provides a step-by-step PoC test plan executable by the scraper agent
- Adds `fast-xml-parser` as a dependency
- Creates `scraper/data/sanctuary-manual.txt` as the manual paste fallback file
- Modifies `.github/workflows/scrape.yml` to add an RSSHub Docker sidecar
- Requires a GitHub Actions secret: `INSTAGRAM_SESSION_ID`


## DEC-0003: RSSHub PoC Status — Docker Not Available, Manual Paste Fallback Built

**Status:** `approved`
**Proposed by:** scraper agent (consolidation sprint)
**Date proposed:** 2026-03-10
**Date resolved:** 2026-03-10 Context
Step 5 of the consolidation sprint called for an RSSHub proof-of-concept. Docker is not currently running on the development machine, so the RSSHub Instagram feed cannot be tested end-to-end.

### Proposal
The Sanctuary scraper (`scraper/scrapers/sanctuary.js`) has been built with dual-mode support:
1. **RSSHub feed** — tries `$RSSHUB_URL/instagram/user/thesanctuaryokc` first (5s timeout, graceful failure)
2. **Manual paste fallback** — reads `scraper/data/sanctuary-manual.txt` (Instagram captions separated by `---` or triple newlines)

Both modes use the shared `regexParse()` and `splitMultiShow()` from `scraper/parse-text.js`. The scraper is wired into the SCRAPERS array and works end-to-end with the manual paste path (verified with sample data).

**To complete the RSSHub PoC:**
1. Start Docker
2. Create burner Instagram account + extract `sessionid` cookie
3. Run: `docker run -d --name rsshub-poc -p 1200:1200 -e INSTAGRAM_SESSION_ID=$INSTAGRAM_SESSION_ID diygod/rsshub:latest`
4. Test: `RSSHUB_URL=http://localhost:1200 node scraper/run-one.js sanctuary`
5. If successful, add `fast-xml-parser` dependency (not needed for manual paste path)

### Alternatives Considered
N/A — this documents current status, not a new approach.

### Decision
Approved. RSSHub PoC deferred to when Docker is available.

### Impact
- Sanctuary scraper is functional via manual paste today
- RSSHub path is coded but untested pending Docker + Instagram session setup
- No new dependencies added yet (`fast-xml-parser` deferred until RSSHub is confirmed working)
