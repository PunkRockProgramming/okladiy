/**
 * Scraper for Beer City Music Hall (Oklahoma City, OK) via Prekindle
 *
 * URL: https://www.prekindle.com/events/beer-city-music-hall
 *
 * The Prekindle events page provides:
 *   - JSON-LD <script> block: array of events with ISO date, price range,
 *     performer names — but NO showtime.
 *   - HTML .pk-eachevent cards: "Doors 7:00pm, Start 8:00pm" in .pk-times div.
 *
 * Strategy: parse JSON-LD for date/price/performers; build a title→time map
 * from the HTML cards; merge by normalized title.
 */

import * as cheerio from 'cheerio';
import { fetchHtml, normalizeShow } from '../utils.js';

const PREKINDLE_URL = 'https://www.prekindle.com/events/beer-city-music-hall';
const VENUE_NAME    = 'Beer City Music Hall';
const VENUE_URL     = 'https://www.beercitymusichall.com';

export async function scrape() {
  const html = await fetchHtml(PREKINDLE_URL);
  const $ = cheerio.load(html);

  // ── Step 1: build title → time map from HTML cards ───────────────────────
  const timeByTitle = new Map();
  $('.pk-eachevent').each((_i, el) => {
    const title = $(el).find('.pk-headline').first().text().trim().toLowerCase();
    const timesText = $(el).find('.pk-times div').first().text().trim();

    // Prefer "Start X:XXpm"; fall back to first time in the string
    const startMatch = timesText.match(/Start\s+(\d{1,2}:\d{2}(?:am|pm))/i);
    const anyMatch   = timesText.match(/(\d{1,2}:\d{2}(?:am|pm))/i);
    const raw        = startMatch?.[1] ?? anyMatch?.[1] ?? null;
    const time       = raw ? raw.replace(/([ap]m)$/i, m => ` ${m.toUpperCase()}`) : null;

    if (title) timeByTitle.set(title, time);
  });

  // ── Step 2: parse JSON-LD events ─────────────────────────────────────────
  const shows = [];

  $('script[type="application/ld+json"]').each((_i, el) => {
    let data;
    try {
      data = JSON.parse($(el).html());
    } catch (_err) {
      return;
    }

    const events = Array.isArray(data)
      ? data
      : data['@graph'] ? data['@graph'] : [data];

    for (const event of events) {
      try {
        if (!event.name || !event.startDate) continue;

        const date = event.startDate.split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        // Look up time from HTML card by normalized title
        const time = timeByTitle.get(event.name.trim().toLowerCase()) ?? null;

        // Price from AggregateOffer
        let price = null;
        const offers = event.offers;
        if (offers) {
          const low  = parseFloat(offers.lowPrice  ?? offers.price ?? '0');
          const high = parseFloat(offers.highPrice ?? '0');
          if (low > 0) {
            price = high > 0 && high !== low
              ? `$${Math.round(low)}–$${Math.round(high)}`
              : `$${Math.round(low)}`;
          }
        }

        // Performers → description
        const performers = (event.performer ?? [])
          .map(p => (typeof p === 'string' ? p : p.name))
          .filter(Boolean);
        const description = performers.length ? performers.join(', ') : null;

        shows.push(
          normalizeShow({
            title:       event.name.trim(),
            venue:       VENUE_NAME,
            venueUrl:    VENUE_URL,
            date,
            time,
            price,
            description,
            eventUrl:    event.url || PREKINDLE_URL,
            ageLimit:    null,
            tags:        [],
          }),
        );
      } catch (_err) {
        // skip malformed event objects
      }
    }
  });

  return shows;
}
