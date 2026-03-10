/**
 * Scraper for Cain's Ballroom (Tulsa, OK)
 *
 * URL: https://www.cainsballroom.com/events/
 *
 * Site type: WordPress + Rock House Events plugin
 *
 * Strategy:
 *   Server-rendered listing page with .eventWrapper cards.
 *   Each card has title, date (month/day), door time, age restriction, ticket link.
 *   Date format on listing is "Fri, Mar 13" — year inferred via parseDate.
 */

import * as cheerio from 'cheerio';
import { fetchHtml, parseDate, normalizeShow } from '../utils.js';

const EVENTS_URL = 'https://www.cainsballroom.com/events/';
const VENUE_NAME = "Cain's Ballroom";
const VENUE_URL  = 'https://www.cainsballroom.com';

export async function scrape() {
  const html = await fetchHtml(EVENTS_URL);
  const $ = cheerio.load(html);

  const shows = [];

  $('.eventWrapper').each((_i, el) => {
    try {
      const $el = $(el);

      const title = $el.find('.eventTitleDiv h2, .eventTitleDiv h1').text().trim();
      if (!title) return;

      // Date: "Fri, Mar 13" in .eventMonth (single element, not split)
      const dateRaw = $el.find('.eventMonth').text().trim();
      if (!dateRaw) return;
      const date = parseDate(dateRaw);
      if (!date) return;

      // Door time: "Doors: 7 pm" or "Doors: 6:30 pm"
      const doorsRaw = $el.find('.eventDoorStartDate').text().trim();
      const timeMatch = doorsRaw.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
      const time = timeMatch ? timeMatch[1] : null;

      // Age restriction
      const ageRaw = $el.find('.eventAgeRestriction').text().trim();
      let ageLimit = null;
      if (/21\+|21 and/i.test(ageRaw)) ageLimit = '21+';
      else if (/18\+|18 and/i.test(ageRaw)) ageLimit = '18+';
      else if (/all ages/i.test(ageRaw)) ageLimit = 'All Ages';

      // Ticket URL
      const ticketUrl = $el.find('.rhp-event-cta a').attr('href') || null;

      // Event detail page URL
      const detailUrl = $el.find('.eventMoreInfo a, .eventTitleDiv a').attr('href') || null;

      const eventUrl = ticketUrl || detailUrl || EVENTS_URL;

      shows.push(
        normalizeShow({
          title,
          venue:       VENUE_NAME,
          venueUrl:    VENUE_URL,
          date,
          time,
          price:       null, // not on listing page
          description: null,
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
