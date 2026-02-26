/**
 * Scraper for Noise Town (Tulsa, OK)
 *
 * Squarespace site — same server-rendered structure as opolis.js.
 * Events page: https://www.noisetowntulsa.com/events
 *
 * Each event article:
 *   <article class="eventlist-event eventlist-event--upcoming">
 *     <div class="eventlist-column-info">
 *       <h1 class="eventlist-title">
 *         <a href="/events/slug" class="eventlist-title-link">Title</a>
 *       </h1>
 *       <ul class="eventlist-meta">
 *         <li class="eventlist-meta-date">
 *           <time class="event-date" datetime="2026-03-07">Saturday, March 7, 2026</time>
 *         </li>
 *         <li class="eventlist-meta-time">
 *           <time class="event-time-localized-start">7:30 PM</time>
 *         </li>
 *       </ul>
 *       <div class="eventlist-excerpt">
 *         <p>Band names and details...</p>
 *         <p>Tickets $10</p>           ← price embedded in description text
 *       </div>
 *     </div>
 *   </article>
 */

import * as cheerio from 'cheerio';
import { fetchHtml, normalizeShow } from '../utils.js';

const BASE_URL   = 'https://www.noisetowntulsa.com';
const EVENTS_URL = `${BASE_URL}/events`;
const VENUE_NAME = 'Noise Town';

export async function scrape() {
  const html = await fetchHtml(EVENTS_URL);
  const $ = cheerio.load(html);

  const shows = [];

  $('.eventlist-event--upcoming').each((_i, el) => {
    try {
      const $el = $(el);

      const title = $el.find('.eventlist-title-link').first().text().trim()
        || $el.find('.eventlist-title').first().text().trim();
      if (!title) return;

      // Event URL
      const hrefRaw = $el.find('.eventlist-title-link').first().attr('href')
        ?? $el.find('a.eventlist-column-thumbnail').attr('href')
        ?? '';
      const eventUrl = hrefRaw
        ? (hrefRaw.startsWith('http') ? hrefRaw : `${BASE_URL}${hrefRaw}`)
        : EVENTS_URL;

      // Date from ISO datetime attribute
      const dateAttr = $el.find('time.event-date').attr('datetime') ?? '';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateAttr) ? dateAttr : null;

      // Start time
      const time = $el.find('.event-time-localized-start').first().text().trim() || null;

      // Price from description text: "Tickets $10" or "$10 advance"
      const descText = $el.find('.eventlist-excerpt').text();
      const priceMatch = descText.match(/(?:tickets?\s*)?\$\s*(\d+(?:\.\d{1,2})?)/i);
      const price = priceMatch ? `$${priceMatch[1]}` : null;

      // Description — use full excerpt text (trim whitespace)
      const description = descText.replace(/\s+/g, ' ').trim() || null;

      // Age limit
      let ageLimit = null;
      $el.find('.eventlist-meta-item').each((_j, li) => {
        if (ageLimit) return;
        const m = $(li).text().match(/\b(all\s*ages?|18\+|21\+)/i);
        if (m) ageLimit = m[1];
      });
      if (!ageLimit) {
        const m = (descText).match(/\b(all\s*ages?|18\+|21\+)/i);
        if (m) ageLimit = m[1];
      }

      shows.push(
        normalizeShow({
          title,
          venue:       VENUE_NAME,
          venueUrl:    BASE_URL,
          date,
          time,
          price,
          description,
          eventUrl,
          ageLimit,
          tags:        [],
        }),
      );
    } catch (_err) {
      // skip malformed entries
    }
  });

  return shows;
}
