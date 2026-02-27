/**
 * Scraper for 89thstreetokc.com
 *
 * The site is a Wix Thunderbolt app. All event data is embedded server-side
 * in a <script id="wix-warmup-data"> JSON blob.
 *
 * We scrape the homepage, which contains a widget component with the full
 * upcoming events list. The data lives at:
 *   appsWarmupData["140603ad-af8d-84a5-2c80-a0f60cb47351"][widgetKey].events.events[]
 *   appsWarmupData["140603ad-af8d-84a5-2c80-a0f60cb47351"][widgetKey].dates.events{}
 *
 * The /events page only exposes a single-event widget when there is one
 * "featured" event, so the homepage is the reliable source for all shows.
 *
 * Date strategy: use startDateISOFormatNotUTC from dates.events[id],
 * which is already expressed in the venue's local timezone (America/Chicago).
 */

import { chromium } from 'playwright';
import { normalizeShow } from '../utils.js';

const EVENTS_URL = 'https://www.89thstreetokc.com/';
const VENUE_NAME = '89th Street OKC';
const VENUE_URL  = 'https://www.89thstreetokc.com';

// Wix Events app ID — stable across Wix sites
const WIX_EVENTS_APP_ID = '140603ad-af8d-84a5-2c80-a0f60cb47351';

export async function scrape() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // Quiet the network — we only need the HTML
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,css}', r => r.abort());

    await page.goto(EVENTS_URL, { waitUntil: 'load', timeout: 30000 });

    // Give the Wix renderer a moment to populate warmup data
    await page.waitForTimeout(1500);

    const { events: rawEvents, dateMap } = await page.evaluate((appId) => {
      try {
        const el = document.getElementById('wix-warmup-data');
        if (!el) return { events: [], dateMap: {} };
        const appData = JSON.parse(el.textContent)?.appsWarmupData?.[appId] ?? {};

        // Find the first widget key that has an events array
        for (const widget of Object.values(appData)) {
          const events = widget?.events?.events;
          if (Array.isArray(events) && events.length > 0) {
            return { events, dateMap: widget?.dates?.events ?? {} };
          }
        }
        return { events: [], dateMap: {} };
      } catch {
        return { events: [], dateMap: {} };
      }
    }, WIX_EVENTS_APP_ID);

    return rawEvents.map(ev => eventToShow(ev, dateMap)).filter(Boolean);
  } finally {
    await browser.close();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a Wix media URI to a static CDN URL.
 * wix:image://v1/{mediaId}/{filename} → https://static.wixstatic.com/media/{mediaId}/v1/fit/w_300,h_300/img.jpg
 */
function wixImageUrl(raw) {
  if (!raw) return null;
  // mainImage is an object with a direct HTTPS url
  if (typeof raw === 'object') return raw.url ?? null;
  // fallback: wix:image://v1/{mediaId}/{filename} URI
  const m = raw.match(/^wix:image:\/\/v1\/([^/]+)\//);
  if (m) return `https://static.wixstatic.com/media/${m[1]}/v1/fit/w_300,h_300/img.jpg`;
  return null;
}

/**
 * Map a raw Wix event object to our show schema.
 */
function eventToShow(ev, dateMap) {
  if (!ev?.id) return null;

  // ── Date & time ────────────────────────────────────────────────────────────
  const dateInfo = dateMap[ev.id];

  // startDateISOFormatNotUTC is already in local time, e.g. "2026-04-23T18:30:00-05:00"
  const localISO = dateInfo?.startDateISOFormatNotUTC
    ?? ev.scheduling?.config?.startDate
    ?? null;
  const date = localISO ? localISO.slice(0, 10) : null;   // "2026-04-23"

  const time = dateInfo?.startTime ?? null;                // "6:30 PM"

  // ── Ticket / event URL ─────────────────────────────────────────────────────
  // Prefer external ticketing URL (Ticketstorm, etc.); fall back to the Wix event page
  const externalUrl = ev.registration?.external?.registration ?? null;
  const eventUrl = externalUrl || (ev.slug ? `${VENUE_URL}/events/${ev.slug}` : VENUE_URL);

  // ── Price ──────────────────────────────────────────────────────────────────
  // Wix doesn't expose ticket price in the warmup data without a separate API call.
  // Leave null — users click through to the ticketing page for price.
  const price = null;

  // ── Image ──────────────────────────────────────────────────────────────────
  // mainImage is an object { id, url, height, width } with a direct HTTPS URL
  const imageUrl = wixImageUrl(ev.mainImage ?? ev.image ?? null);

  // ── Age / all-ages ─────────────────────────────────────────────────────────
  // 89th Street is explicitly "all ages"; note if mentioned in description
  const desc = (ev.description ?? '').trim();
  const ageMatch = desc.match(/\b(all\s*ages?|18\+|21\+)\b/i);
  const ageLimit = ageMatch ? ageMatch[1] : 'All ages';

  return normalizeShow({
    title:       (ev.title ?? '').trim(),
    venue:       VENUE_NAME,
    venueUrl:    VENUE_URL,
    date,
    time,
    price,
    description: desc || null,
    eventUrl,
    ageLimit,
    tags:        [],
    imageUrl,
  });
}
