/**
 * Scraper for opolis.org/opolisevents (Norman, OK)
 *
 * Structure: server-rendered Squarespace page at /opolisevents (NOT /events).
 * Squarespace marks upcoming vs past with CSS modifier classes.
 *
 * Each event article:
 *   <article class="eventlist-event eventlist-event--upcoming">
 *     <a href="/opolisevents/slug" class="eventlist-column-thumbnail">
 *     <div class="eventlist-column-info">
 *       <h1 class="eventlist-title">
 *         <a href="/opolisevents/slug" class="eventlist-title-link">Title</a>
 *       </h1>
 *       <ul class="eventlist-meta">
 *         <li class="eventlist-meta-date">
 *           <time class="event-date" datetime="2026-03-14">Friday, March 14, 2026</time>
 *         </li>
 *         <li class="eventlist-meta-time">
 *           <time class="event-time-localized-start" datetime="...">9:00 PM</time>
 *         </li>
 *         <li class="eventlist-meta-address">Opolis <a>(map)</a></li>
 *         <li>18+ · 21+ to drink</li>   ← age (sometimes)
 *       </ul>
 *     </div>
 *   </article>
 */

import * as cheerio from 'cheerio';
import { normalizeShow } from '../utils.js';
import { fetchHtml } from '../utils.js';

const BASE_URL = 'https://www.opolis.org';
const EVENTS_URL = `${BASE_URL}/opolisevents`;
const VENUE_NAME = 'Opolis';

export async function scrape() {
  const html = await fetchHtml(EVENTS_URL);
  const $ = cheerio.load(html);

  const shows = [];

  // Only scrape upcoming events; Squarespace marks them with --upcoming modifier
  $('.eventlist-event--upcoming').each((_i, el) => {
    try {
      const $el = $(el);

      const title = $el.find('.eventlist-title-link').first().text().trim()
        || $el.find('.eventlist-title').first().text().trim();
      if (!title) return;

      // Event URL from title link
      const hrefRaw = $el.find('.eventlist-title-link').first().attr('href')
        ?? $el.find('a.eventlist-column-thumbnail').attr('href')
        ?? '';
      const eventUrl = hrefRaw
        ? (hrefRaw.startsWith('http') ? hrefRaw : `${BASE_URL}${hrefRaw}`)
        : EVENTS_URL;

      // Date from <time datetime="2026-03-14"> — ISO attribute is reliable
      const dateAttr = $el.find('time.event-date').attr('datetime') ?? '';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateAttr) ? dateAttr : null;

      // Start time from <time class="event-time-localized-start">
      const time = $el.find('.event-time-localized-start').first().text().trim() || null;

      // Thumbnail image from Squarespace event thumbnail column
      const rawImgSrc = $el.find('.eventlist-column-thumbnail img').first().attr('src') || null;
      const imageUrl = rawImgSrc ? rawImgSrc.replace(/\?format=\w+$/, '?format=1000w') : null;

      // Age limit — scan all meta items
      let ageLimit = null;
      $el.find('.eventlist-meta-item').each((_j, li) => {
        if (ageLimit) return;
        const text = $(li).text().trim();
        const m = text.match(/\b(all\s*ages?|18\+|21\+)/i);
        if (m) ageLimit = m[1];
      });

      shows.push(
        normalizeShow({
          title,
          venue: VENUE_NAME,
          venueUrl: BASE_URL,
          date,
          time,
          price: null, // tickets via Eventbrite, not in listing
          description: null,
          eventUrl,
          ageLimit,
          tags: [],
          imageUrl,
        }),
      );
    } catch (_err) {
      // skip malformed entries
    }
  });

  return shows;
}
