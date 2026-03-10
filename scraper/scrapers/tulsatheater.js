/**
 * Scraper for Tulsa Theater (Tulsa, OK)
 *
 * URL: https://tulsatheater.com/events/
 *
 * Site type: WordPress + Rock House Events plugin (same as Cain's Ballroom, Diamond Ballroom)
 *
 * Strategy:
 *   Server-rendered listing page with .eventWrapper cards.
 *   Each card has title, date, door/show time, ticket link.
 *   Door time format: "Doors | 6:30 pm // Show | 7:30 pm"
 */

import * as cheerio from 'cheerio';
import { fetchHtml, parseDate, normalizeShow } from '../utils.js';

const EVENTS_URL = 'https://tulsatheater.com/events/';
const VENUE_NAME = 'Tulsa Theater';
const VENUE_URL  = 'https://tulsatheater.com';

export async function scrape() {
  const html = await fetchHtml(EVENTS_URL);
  const $ = cheerio.load(html);

  const shows = [];

  $('.eventWrapper').each((_i, el) => {
    try {
      const $el = $(el);

      const title = $el.find('.eventTitleDiv h2, .eventTitleDiv h1').text().trim();
      if (!title) return;

      // Date: "Thu, Mar 12" in .eventMonth
      const dateRaw = $el.find('.eventMonth').text().trim();
      if (!dateRaw) return;
      const date = parseDate(dateRaw);
      if (!date) return;

      // Time: "Doors | 6:30 pm // Show | 7:30 pm" — extract first time
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
      const detailUrl = $el.find('.eventMoreInfo a, .eventTitleDiv a').attr('href') || null;
      const eventUrl = ticketUrl || detailUrl || EVENTS_URL;

      shows.push(
        normalizeShow({
          title,
          venue:       VENUE_NAME,
          venueUrl:    VENUE_URL,
          date,
          time,
          price:       null,
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
