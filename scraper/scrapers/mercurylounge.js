/**
 * Scraper for Mercury Lounge (Tulsa, OK)
 *
 * The main site is Wix and their events widget is loaded in a hidden iframe
 * that embeds a Prekindle organizer calendar widget. That widget page is
 * server-rendered HTML — no Playwright needed.
 *
 * Widget URL:
 *   https://www.prekindle.com/organizer-grid-widget-main/id/24898849004906244/
 *
 * Each .pk-eachevent card:
 *   .pk-headline               — title
 *   .pk-date-day               — "Thursday"
 *   .pk-date                   — "February 26"  (no year)
 *   .pk-times > div            — "Doors 7:00pm, Start 8:00pm"
 *   a.pk-title-link[href]      — Prekindle event URL
 */

import * as cheerio from 'cheerio';
import { fetchHtml, parseDate, normalizeShow } from '../utils.js';

const WIDGET_URL = 'https://www.prekindle.com/organizer-grid-widget-main/id/24898849004906244/?fp=false&thumbs=true&style=null';
const VENUE_NAME = 'Mercury Lounge';
const VENUE_URL  = 'https://www.mercuryloungetulsa.com';

export async function scrape() {
  const html = await fetchHtml(WIDGET_URL);
  const $ = cheerio.load(html);

  const shows = [];

  $('.pk-eachevent').each((_i, el) => {
    try {
      const $el = $(el);

      const title = $el.find('.pk-headline').first().text().trim();
      if (!title) return;

      // Date: "Thursday February 26" — combine day name + date for parseDate
      const dayName  = $el.find('.pk-date-day').first().text().trim();  // "Thursday"
      const dateText = $el.find('.pk-date').first().text().trim();      // "February 26"
      const combined = dayName && dateText ? `${dayName}, ${dateText}` : dateText;
      const date = parseDate(combined); // uses 'EEEE, MMMM d' or 'MMMM d' format

      // Time: "Doors 7:00pm, Start 8:00pm" — extract show start time
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

      // Thumbnail image from Prekindle widget card
      const imageUrl = $el.find('.pk-image img').first().attr('src') || null;

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
