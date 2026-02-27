/**
 * Scraper for Tower Theatre OKC via Prekindle
 *
 * Tower Theatre's own site (towertheatreokc.com) is JS-rendered (Hive SDK).
 * Prekindle is the authorized ticketing partner and embeds all events as
 * JSON-LD structured data in the initial server-rendered HTML — no Playwright needed.
 *
 * JSON-LD schema per event:
 *   name, startDate (ISO date or datetime), url,
 *   offers.{ lowPrice, highPrice, priceCurrency },
 *   performer[].name
 */

import * as cheerio from 'cheerio';
import { fetchHtml, normalizeShow } from '../utils.js';

const PREKINDLE_URL = 'https://www.prekindle.com/events/tower-theatre';
const VENUE_NAME = 'Tower Theatre';
const VENUE_URL = 'https://www.towertheatreokc.com';

export async function scrape() {
  const html = await fetchHtml(PREKINDLE_URL);
  const $ = cheerio.load(html);

  const shows = [];

  $('script[type="application/ld+json"]').each((_i, el) => {
    let data;
    try {
      data = JSON.parse($(el).html());
    } catch (_err) {
      return; // skip unparseable blocks
    }

    // JSON-LD may be a single event object, an array, or an @graph wrapper
    const events = Array.isArray(data)
      ? data
      : data['@graph']
        ? data['@graph']
        : [data];

    for (const event of events) {
      try {
        if (!event.name || !event.startDate) continue;

        // startDate may be "2026-03-14" or "2026-03-14T20:00:00+0000"
        const date = event.startDate.split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        // Price from AggregateOffer
        let price = null;
        const offers = event.offers;
        if (offers) {
          const low = parseFloat(offers.lowPrice ?? offers.price ?? '0');
          const high = parseFloat(offers.highPrice ?? '0');
          if (low > 0) {
            price =
              high > 0 && high !== low
                ? `$${Math.round(low)}–$${Math.round(high)}`
                : `$${Math.round(low)}`;
          }
        }

        // Performers → use as description
        const performers = (event.performer ?? [])
          .map((p) => (typeof p === 'string' ? p : p.name))
          .filter(Boolean);
        const description = performers.length ? performers.join(', ') : null;

        shows.push(
          normalizeShow({
            title: event.name.trim(),
            venue: VENUE_NAME,
            venueUrl: VENUE_URL,
            date,
            time: null, // not in JSON-LD; on individual detail pages only
            price,
            description,
            eventUrl: event.url || PREKINDLE_URL,
            ageLimit: null,
            tags: [],
            imageUrl: event.image || null,
          }),
        );
      } catch (_err) {
        // skip malformed event objects
      }
    }
  });

  return shows;
}
