/**
 * Scraper for noladiy.org/events.php
 *
 * Structure: server-rendered HTML. Events are `.event` divs, dates are
 * `.divider` divs — siblings at the same DOM level. Walk them in sequence.
 *
 * Inside each `.event`:
 *   <a name='EVENTID'></a>
 *   Title text<br>
 *   Weekday, Month Day. <a href="/venue.php?VenueID=N">Venue</a>. 8PM. $15.<br>
 *   Description text
 */

import * as cheerio from 'cheerio';
import { fetchHtml, parseDate, normalizeShow } from '../utils.js';

const BASE_URL = 'https://www.noladiy.org';
const EVENTS_URL = `${BASE_URL}/events.php`;
const VENUE_NAME = 'noladiy.org';

export async function scrape() {
  const html = await fetchHtml(EVENTS_URL);
  const $ = cheerio.load(html, { decodeEntities: true });

  const shows = [];
  let currentDateRaw = null;

  $('.divider, .event').each((_i, el) => {
    const $el = $(el);

    if ($el.hasClass('divider')) {
      currentDateRaw = $el.text().trim(); // "Thursday, February 26"
      return;
    }

    if (!$el.hasClass('event') || !currentDateRaw) return;

    try {
      // Event ID → used as URL fragment
      const eventId = $el.find('a[name]').first().attr('name');

      // Split on <br> to get title line and meta line separately
      const rawHtml = $el.html() ?? '';
      const parts = rawHtml.split(/<br\s*\/?>/i);

      // Part 0: <a name='N'></a>Title text
      const $titlePart = cheerio.load(parts[0] ?? '');
      const title = $titlePart.text().trim();
      if (!title) return;

      // Part 1: "Thursday, Feb 26. Venue. 8PM. $15."
      const $meta = cheerio.load(parts[1] ?? '');
      const metaText = $meta.text().trim();

      // Venue — prefer the link; fall back to parsing plain text
      const $venueLink = $meta('a[href*="venue.php"]');
      let venueName = null;
      let venueUrl = null;
      if ($venueLink.length) {
        venueName = $venueLink.text().trim();
        const href = $venueLink.attr('href') ?? '';
        venueUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      } else {
        // Try to extract venue from position after date ("Weekday, Month Day. VENUE. ...")
        const segments = metaText.split('.').map((s) => s.trim()).filter(Boolean);
        // segments[0] is usually "Thursday, February 26"
        // segments[1] is usually the venue name
        venueName = segments[1] ?? null;
      }

      // Time — "8PM", "7:30PM", "9 PM", etc.
      const timeMatch = metaText.match(/\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\b/i);
      const time = timeMatch ? timeMatch[1].replace(/\s+/, '').toUpperCase() : null;

      // Price — "$15", "$10/$15", "FREE", "$20 advance", "$60+"
      const priceMatch = metaText.match(/\$[\d]+(?:[./+][\d]+)*(?:\s*\([^)]+\))?|FREE\b/i);
      const price = priceMatch ? priceMatch[0] : null;

      // Age limit — "18+", "21+", "All ages"
      const ageMatch = metaText.match(/\b(all\s*ages?|18\+|21\+)\b/i);
      const ageLimit = ageMatch ? ageMatch[1] : null;

      // Description — everything after the second <br>
      const descHtml = parts.slice(2).join(' ');
      const description = cheerio.load(descHtml).text().trim() || null;

      // Date — parse "Thursday, February 26" with year heuristic in parseDate
      const date = parseDate(currentDateRaw);

      const eventUrl = eventId ? `${EVENTS_URL}#${eventId}` : EVENTS_URL;

      shows.push(
        normalizeShow({
          title,
          venue: venueName ?? VENUE_NAME,
          venueUrl,
          date,
          time,
          price,
          description,
          eventUrl,
          ageLimit,
          tags: [],
        }),
      );
    } catch (err) {
      // Skip malformed entries silently; the entry point logs per-scraper errors
    }
  });

  return shows;
}
