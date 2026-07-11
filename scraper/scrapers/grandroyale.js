/**
 * Scraper for Grand Royale (Oklahoma City, OK — Plaza District)
 *
 * The main site (grandroyaleokc.com/events) embeds a Prekindle calendar
 * widget via pk-cal-loader.js with data-org-id="-2852852648693208159".
 * The organizer grid widget page is server-rendered HTML — no Playwright
 * needed. Same pattern as Mercury Lounge.
 *
 * Widget URL:
 *   https://www.prekindle.com/organizer-grid-widget-main/id/-2852852648693208159/
 *
 * Each .pk-eachevent card:
 *   .pk-headline               — title
 *   .pk-date-day               — "Saturday"
 *   .pk-date                   — "July 11"  (no year)
 *   .pk-times > div            — "Doors 8:00pm, Start 9:00pm"
 *   a.pk-title-link[href]      — Prekindle event URL
 */

import * as cheerio from 'cheerio';
import { fetchHtml, parseDate, normalizeShow } from '../utils.js';

const WIDGET_URL = 'https://www.prekindle.com/organizer-grid-widget-main/id/-2852852648693208159/?fp=false&thumbs=true&style=null';
const VENUE_NAME = 'Grand Royale';
const VENUE_URL  = 'https://grandroyaleokc.com';

export async function scrape() {
  const html = await fetchHtml(WIDGET_URL);
  const $ = cheerio.load(html);

  const shows = [];

  $('.pk-eachevent').each((_i, el) => {
    try {
      const $el = $(el);

      const title = $el.find('.pk-headline').first().text().trim();
      if (!title) return;

      // Date: "Saturday July 11" — combine day name + date for parseDate
      const dayName  = $el.find('.pk-date-day').first().text().trim();  // "Saturday"
      const dateText = $el.find('.pk-date').first().text().trim();      // "July 11"
      const combined = dayName && dateText ? `${dayName}, ${dateText}` : dateText;
      const date = parseDate(combined); // uses 'EEEE, MMMM d' or 'MMMM d' format

      // Time: "Doors 8:00pm, Start 9:00pm" — extract show start time
      const timesText = $el.find('.pk-times div').first().text().trim();
      let time = null;
      const startMatch = timesText.match(/Start\s+(\d{1,2}:\d{2}(?:am|pm))/i);
      if (startMatch) {
        time = startMatch[1].replace('am', ' AM').replace('pm', ' PM');
      } else {
        // Fall back to first time in string
        const anyTime = timesText.match(/(\d{1,2}:\d{2}(?:am|pm))/i);
        if (anyTime) time = anyTime[1].replace('am', ' AM').replace('pm', ' PM');
      }

      // Event URL
      const href = $el.find('a.pk-title-link').attr('href') ?? '';
      const eventUrl = href || VENUE_URL;

      // Thumbnail image from Prekindle widget card — strip _t suffix for full resolution
      const rawImgSrc = $el.find('.pk-image img').first().attr('src') || null;
      const imageUrl  = rawImgSrc ? rawImgSrc.replace(/_t$/, '') : null;

      shows.push(
        normalizeShow({
          title,
          venue:    VENUE_NAME,
          venueUrl: VENUE_URL,
          date,
          time,
          price:       null,
          description: null,
          eventUrl,
          ageLimit:    null,
          tags:        [],
          imageUrl,
        }),
      );
    } catch (_err) {
      // skip malformed entries
    }
  });

  return shows;
}
