/**
 * Scraper for tulsashrine.com (Tulsa, OK)
 *
 * Strategy:
 *   Primary — WordPress REST API (The Events Calendar plugin):
 *     GET https://www.tulsashrine.com/wp-json/tribe/events/v1/events?per_page=50
 *     Falls back to HTML if non-2xx, network error, or non-JSON response.
 *
 *   Fallback — HTML batch scrape:
 *     1. Collect a[href*="/event/"] links from listing page
 *     2. Batch-fetch detail pages (8 concurrent, direct fetch — Diamond Ballroom pattern)
 *     3. Parse ul li text by "Date:", "Doors:", "Age:", "Prices:" prefixes
 *
 * Fields: title, date, time, price (ADV/DAY OF parsed), ageLimit, eventUrl, imageUrl
 */

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { fetchHtml, parseDate, normalizePrice, normalizeShow, delay } from '../utils.js';

const VENUE_NAME  = 'The Venue Shrine';
const VENUE_URL   = 'https://www.tulsashrine.com';
const LISTING_URL = `${VENUE_URL}/`;
const REST_URL    = `${VENUE_URL}/wp-json/tribe/events/v1/events?per_page=50`;
const UA = 'Mozilla/5.0 (compatible; okdiy-scraper/1.0; +https://github.com/local/okdiy)';

export async function scrape() {
  // Primary: WordPress REST API
  try {
    const res = await fetch(REST_URL, { headers: { 'User-Agent': UA }, timeout: 10000 });
    if (res.ok) {
      const text = await res.text();
      const json = JSON.parse(text); // throws if not JSON
      if (Array.isArray(json.events)) {
        return json.events.map(eventFromApi).filter(Boolean);
      }
    }
  } catch {
    // fall through to HTML scraping
  }

  // Fallback: HTML scraping
  return scrapeHtml();
}

// ── REST API path ─────────────────────────────────────────────────────────────

function eventFromApi(ev) {
  const title = ev.title?.rendered?.trim();
  if (!title) return null;
  const date = ev.start_date?.slice(0, 10) ?? null;
  const todayISO = new Date().toISOString().slice(0, 10);
  if (!date || date < todayISO) return null;
  const time = ev.start_date ? parseTime12h(ev.start_date) : null;
  const price = ev.cost ? normalizePrice(ev.cost) : null;
  return normalizeShow({
    title,
    venue:    VENUE_NAME,
    venueUrl: VENUE_URL,
    date,
    time,
    price,
    description: null,
    eventUrl: ev.url ?? VENUE_URL,
    ageLimit: null,
    tags:     ['tulsa'],
    imageUrl: ev.image?.url ?? null,
  });
}

// ── HTML fallback path ────────────────────────────────────────────────────────

async function scrapeHtml() {
  const html = await fetchHtml(LISTING_URL);
  const $ = cheerio.load(html);
  const todayISO = new Date().toISOString().slice(0, 10);

  // Collect event detail page links (deduplicated)
  const links = new Set();
  $('a[href*="/event/"]').each((_i, el) => {
    const href = $(el).attr('href');
    if (href) links.add(href.startsWith('http') ? href : `${VENUE_URL}${href}`);
  });
  if (links.size === 0) return [];

  // Batch-fetch detail pages — Diamond Ballroom pattern: direct fetch, not fetchHtml
  const urls  = [...links];
  const BATCH = 8;
  const shows = [];

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(u =>
        fetch(u, { headers: { 'User-Agent': UA }, timeout: 15000 }).then(r => r.text()),
      ),
    );
    if (i + BATCH < urls.length) await delay(400, 600);

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const show = parseDetailPage(result.value, todayISO);
      if (show) shows.push(show);
    }
  }

  return shows;
}

function parseDetailPage(html, todayISO) {
  const $ = cheerio.load(html);
  // tulsashrine.com detail pages use h2 for the event title, not h1
  const title = $('h2').first().text().trim();
  if (!title) return null;

  let date = null, time = null, ageLimit = null, price = null;
  const ticketUrl = $('a[href*="stubwire.com/order"]').first().attr('href') ?? null;
  const eventUrl  = ticketUrl ?? VENUE_URL;

  // Parse ul li items by prefix label
  $('ul li').each((_i, el) => {
    const text = $(el).text().trim();
    if (text.startsWith('Date:')) {
      // Strip day-of-week prefix before passing to parseDate
      const raw = text.replace(/^Date:\s*/, '').replace(/^\w+,?\s+/, '');
      date = parseDate(raw);
    } else if (text.startsWith('Doors:')) {
      time = text.replace(/^Doors:\s*/, '').trim() || null;
    } else if (text.startsWith('Age:')) {
      ageLimit = text.replace(/^Age:\s*/, '').trim() || null;
    } else if (text.startsWith('Prices:')) {
      const raw = text.replace(/^Prices:\s*/, '').trim();
      const m   = raw.match(/\$(\d+(?:\.\d+)?)\s+ADV\s+\$(\d+(?:\.\d+)?)\s+DAY OF/i);
      price = m ? `$${parseInt(m[1])} adv / $${parseInt(m[2])} door` : normalizePrice(raw);
    }
  });

  if (!date || date < todayISO) return null;

  // Image: StubWire CDN preferred; fallback to any article img or og:image meta
  const imageUrl =
    $('img[src*="stubwire-public.storage.googleapis.com"]').first().attr('src') ??
    $('article img').first().attr('src') ??
    $('meta[property="og:image"]').attr('content') ??
    null;

  return normalizeShow({
    title,
    venue:    VENUE_NAME,
    venueUrl: VENUE_URL,
    date,
    time,
    price,
    description: null,
    eventUrl,
    ageLimit,
    tags:     ['tulsa'],
    imageUrl,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse ISO datetime string to 12-hour time. "2026-03-20T20:00:00" → "8 PM" */
function parseTime12h(isoStr) {
  const m = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min  = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return min === '00' ? `${h} ${ampm}` : `${h}:${min} ${ampm}`;
}
