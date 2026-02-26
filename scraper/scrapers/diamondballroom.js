/**
 * Scraper for diamondballroom.com (Oklahoma City, OK)
 *
 * The events listing page is JS-rendered (WordPress + Rock House Events plugin),
 * but individual event pages are server-rendered and contain a JSON-LD Event
 * schema with full data including showtime.
 *
 * Strategy:
 *   1. Parse https://diamondballroom.com/rhp_events-sitemap.xml for event URLs.
 *      Filter to entries with lastmod within the past year to skip obviously
 *      stale past events and keep the request count manageable (~50-60 fetches).
 *   2. Fetch each event page sequentially (fetchHtml adds a polite delay).
 *   3. Extract JSON-LD, filter to events whose startDate >= today.
 *
 * JSON-LD schema per event:
 *   name, startDate ("2026-03-01T19:30:00-0500"), url,
 *   offers.{ price, url (etix) }, location.name
 */

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { fetchHtml, delay, normalizeShow } from '../utils.js';

const SITEMAP_URL = 'https://diamondballroom.com/rhp_events-sitemap.xml';
const VENUE_NAME = 'Diamond Ballroom';
const VENUE_URL  = 'https://www.diamondballroom.com';

export async function scrape() {
  // ── Step 1: get candidate URLs from sitemap ──────────────────────────────
  const sitemapHtml = await fetchHtml(SITEMAP_URL);
  const $s = cheerio.load(sitemapHtml, { xmlMode: true });

  // Only look at events modified within the past year; past events are rarely touched
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoff = oneYearAgo.toISOString().slice(0, 10); // "2025-02-27"

  const candidateUrls = [];
  $s('url').each((_i, el) => {
    const loc     = $s(el).find('loc').text().trim();
    const lastmod = $s(el).find('lastmod').text().trim().slice(0, 10);
    if (loc.includes('/event/') && lastmod >= cutoff) {
      candidateUrls.push(loc);
    }
  });

  // ── Step 2: fetch event pages in parallel batches ────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().slice(0, 10); // "2026-02-27"

  const UA = 'Mozilla/5.0 (compatible; okladiy-scraper/1.0; +https://github.com/local/okladiy)';
  const BATCH = 8; // concurrent requests per batch
  const shows = [];

  for (let i = 0; i < candidateUrls.length; i += BATCH) {
    const batch = candidateUrls.slice(i, i + BATCH);
    const htmlResults = await Promise.allSettled(
      batch.map(u => fetch(u, { headers: { 'User-Agent': UA }, timeout: 15000 }).then(r => r.text()))
    );
    if (i + BATCH < candidateUrls.length) await delay(400, 600); // polite pause between batches

    for (const result of htmlResults) {
      if (result.status !== 'fulfilled') continue;
      const html = result.value;
      const $ = cheerio.load(html);

      $('script[type="application/ld+json"]').each((_i, el) => {
        try {
          const data = JSON.parse($(el).html());
          const events = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];

          for (const event of events) {
            if (event['@type'] !== 'Event' || !event.name || !event.startDate) continue;

            // startDate: "2026-03-01T19:30:00-0500"
            const date = event.startDate.slice(0, 10);
            if (date < todayISO) continue; // skip past events

            // Extract time from datetime string: "T19:30:00" → "7:30 PM"
            const time = parseTime(event.startDate);

            // Price: offers.price is sometimes 0 (not set); treat 0 as unknown
            const priceNum = parseFloat(event.offers?.price ?? 0);
            const price = priceNum > 0 ? `$${Math.round(priceNum)}` : null;

            // Prefer Etix ticket URL; fall back to event page
            const eventUrl = event.offers?.url || event.url || VENUE_URL;

            // WordPress stores titles with HTML entities (&#8211; etc.) — decode them
            const title = cheerio.load(`<t>${event.name}</t>`)('t').text().trim();

            shows.push(
              normalizeShow({
                title,
                venue:       VENUE_NAME,
                venueUrl:    VENUE_URL,
                date,
                time,
                price,
                description: null,
                eventUrl,
                ageLimit:    null,
                tags:        [],
              }),
            );
          }
        } catch (_err) {
          // skip unparseable JSON-LD blocks
        }
      });
    } // end for htmlResults
  } // end for batch

  return shows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse time from an ISO datetime string.
 * "2026-03-01T19:30:00-0500" → "7:30 PM"
 * Returns null if no time component.
 */
function parseTime(isoStr) {
  const match = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m === '00' ? `${h} ${ampm}` : `${h}:${m} ${ampm}`;
}
