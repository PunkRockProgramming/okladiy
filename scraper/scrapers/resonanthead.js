/**
 * Scraper for Resonant Head (Oklahoma City, OK) via Prekindle
 *
 * Uses the same JSON-LD pattern as Tower Theatre and Whittier Bar.
 * Price data is included in the offers block.
 */

import * as cheerio from 'cheerio';
import { fetchHtml, normalizeShow } from '../utils.js';

const PREKINDLE_URL = 'https://www.prekindle.com/events/resonant-head';
const VENUE_NAME = 'Resonant Head';
const VENUE_URL  = 'https://www.resonanthead.com';

export async function scrape() {
  const html = await fetchHtml(PREKINDLE_URL);
  const $ = cheerio.load(html);

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
      : data['@graph']
        ? data['@graph']
        : [data];

    for (const event of events) {
      try {
        if (!event.name || !event.startDate) continue;

        const date = event.startDate.split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

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

        const performers = (event.performer ?? [])
          .map((p) => (typeof p === 'string' ? p : p.name))
          .filter(Boolean);
        const description = performers.length ? performers.join(', ') : null;

        shows.push(
          normalizeShow({
            title:       event.name.trim(),
            venue:       VENUE_NAME,
            venueUrl:    VENUE_URL,
            date,
            time:        null,
            price,
            description,
            eventUrl:    event.url || PREKINDLE_URL,
            ageLimit:    null,
            tags:        [],
            imageUrl:    event.image || null,
          }),
        );
      } catch (_err) {
        // skip malformed event objects
      }
    }
  });

  return shows;
}
