/**
 * Scraper for The Vanguard (Tulsa, OK)
 *
 * Webflow site with server-rendered event listings.
 *
 * Strategy:
 *   1. Fetch /shows listing page — get title, date, slug for each event.
 *   2. Filter to upcoming events (date >= today) before making detail requests.
 *   3. Fetch each event detail page — extract time and price from the
 *      hidden #event-data element and the "Show:" time block.
 *
 * Listing page selectors:
 *   .ec-col-item.w-dyn-item     — event container
 *   .title > div                — title (may start with "SOLD OUT | ")
 *   .start-date > div           — "February 26, 2026"
 *   a.webflow-link              — href="/shows/slug"
 *
 * Detail page:
 *   #event-data[data-price]     — "$23.04"
 *   #event-data[data-description] — performers as comma-separated string
 *   .uui-event_time-wrapper     — "Doors: 7:00 pm / Show: 8:00 pm"
 */

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { fetchHtml, delay, parseDate, normalizeShow } from '../utils.js';

const BASE_URL   = 'https://www.thevanguardtulsa.com';
const EVENTS_URL = `${BASE_URL}/shows`;
const VENUE_NAME = 'The Vanguard';

export async function scrape() {
  // ── Step 1: listing page ──────────────────────────────────────────────────
  const listHtml = await fetchHtml(EVENTS_URL);
  const $l = cheerio.load(listHtml);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const candidates = [];
  $l('.ec-col-item.w-dyn-item').each((_i, el) => {
    try {
      const $el = $l(el);
      const rawTitle = $el.find('.title > div').first().text().trim();
      if (!rawTitle) return;
      // Strip "SOLD OUT | " prefix and similar status prefixes
      const title = rawTitle.replace(/^(?:SOLD\s*OUT|CANCELLED|CANCELED)\s*[|–-]\s*/i, '').trim();

      const dateText = $el.find('.start-date > div').first().text().trim();
      const date = parseDate(dateText); // "February 26, 2026" → '2026-02-26'
      if (!date) return;
      if (new Date(date) < today) return; // skip past events

      const href = $el.find('a.webflow-link').attr('href') ?? '';
      const eventUrl = href
        ? (href.startsWith('http') ? href : `${BASE_URL}${href}`)
        : EVENTS_URL;

      candidates.push({ title, date, eventUrl });
    } catch (_err) {
      // skip malformed entries
    }
  });

  // ── Step 2: fetch detail pages in parallel batches ───────────────────────
  const UA = 'Mozilla/5.0 (compatible; okladiy-scraper/1.0; +https://github.com/local/okladiy)';
  const BATCH = 8;
  const shows = [];

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const htmlResults = await Promise.allSettled(
      batch.map(({ eventUrl }) =>
        fetch(eventUrl, { headers: { 'User-Agent': UA }, timeout: 15000 }).then(r => r.text())
      )
    );
    if (i + BATCH < candidates.length) await delay(400, 600);

    for (let j = 0; j < batch.length; j++) {
      const { title, date, eventUrl } = batch[j];
      const result = htmlResults[j];

      if (result.status !== 'fulfilled') {
        shows.push(normalizeShow({ title, venue: VENUE_NAME, venueUrl: BASE_URL, date, time: null, price: null, description: null, eventUrl, ageLimit: null, tags: [] }));
        continue;
      }

      const $ = cheerio.load(result.value);

      const priceRaw = $('#event-data').attr('data-price') ?? '';
      const price = priceRaw.match(/\$[\d.]+/) ? priceRaw.trim() : null;
      const description = $('#event-data').attr('data-description')?.trim() || null;

      const timeWrapper = $('.uui-event_time-wrapper').text();
      const showMatch = timeWrapper.match(/Show[:\s]+(\d{1,2}:\d{2}\s*(?:am|pm))/i);
      const time = showMatch
        ? showMatch[1].replace(/\s+/, '').toUpperCase().replace('AM', ' AM').replace('PM', ' PM').trim()
        : null;

      const bodyText = $('body').text();
      const ageMatch = bodyText.match(/\b(all\s*ages?|18\+|21\+)\b/i);
      const ageLimit = ageMatch ? ageMatch[1] : null;

      shows.push(normalizeShow({ title, venue: VENUE_NAME, venueUrl: BASE_URL, date, time, price, description, eventUrl, ageLimit, tags: [] }));
    }
  }

  return shows;
}
