/**
 * Scraper for VENUE NAME (City, State)
 *
 * URL: https://example.com/events
 *
 * Site type: [server-rendered HTML / Prekindle JSON-LD / Squarespace / Webflow / Wix+Playwright / WP sitemap]
 *
 * Strategy:
 *   Describe what you fetch and how you extract data.
 *   Note any multi-step fetching (listing → detail pages).
 *
 * Key selectors:
 *   .event-item        — event container
 *   .event-title       — title text
 *   time[datetime]     — ISO date attribute
 */

import * as cheerio from 'cheerio';
import { fetchHtml, parseDate, normalizeShow } from '../utils.js';

const EVENTS_URL = 'https://example.com/events';
const VENUE_NAME = 'Venue Name';
const VENUE_URL  = 'https://example.com';

export async function scrape() {
  const html = await fetchHtml(EVENTS_URL);
  const $ = cheerio.load(html);

  const shows = [];

  // TODO: replace with real selectors
  $('.event-item').each((_i, el) => {
    try {
      const $el = $(el);

      const title    = $el.find('.event-title').text().trim();
      const dateRaw  = $el.find('time').attr('datetime') ?? $el.find('.event-date').text().trim();
      const date     = parseDate(dateRaw);
      const time     = $el.find('.event-time').text().trim() || null;
      const price    = $el.find('.event-price').text().trim() || null;
      const eventUrl = $el.find('a').attr('href') ?? EVENTS_URL;

      if (!title || !date) return; // skip incomplete entries

      shows.push(
        normalizeShow({
          title,
          venue:       VENUE_NAME,
          venueUrl:    VENUE_URL,
          date,
          time,
          price,
          description: null,
          eventUrl:    eventUrl.startsWith('http') ? eventUrl : `${VENUE_URL}${eventUrl}`,
          ageLimit:    null,
          tags:        [],
        }),
      );
    } catch (_err) {
      // skip malformed entries
    }
  });

  return shows;
}

// ── To wire up ────────────────────────────────────────────────────────────────
// 1. Rename this file to your venue slug (e.g. myvenueokc.js)
// 2. In scraper/index.js:
//      import { scrape as scrapeMyVenue } from './scrapers/myvenueokc.js';
//      { name: 'myvenueokc', fn: scrapeMyVenue },
// 3. Test: node scraper/run-one.js myvenueokc
