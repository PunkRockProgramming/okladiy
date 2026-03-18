/**
 * Scraper for thesoundpony.com/calendar (Tulsa, OK)
 *
 * Squarespace YUI3 calendar block. The standard ?format=json API does not
 * work for calendar-type collections, and the page renders no eventlist HTML.
 *
 * Strategy:
 *   Use Playwright to load the calendar page and intercept the Squarespace
 *   GetItemsByMonth API calls. The page fires one call for the current month
 *   on load; we then click the "next month" nav arrow to trigger a second call.
 *   This gives us ~4–8 weeks of upcoming shows.
 *
 *   Event timestamps are UTC milliseconds. Soundpony is in Tulsa (CST = UTC−6,
 *   CDT = UTC−5). We derive the local date from the fullUrl slug which encodes
 *   the correct local date (e.g. /live-music/2026/3/28/slug).
 *   Time is computed from the timestamp using a UTC offset for the local zone.
 */

import { chromium } from 'playwright';
import { normalizeShow } from '../utils.js';

const BASE_URL   = 'https://www.thesoundpony.com';
const EVENTS_URL = `${BASE_URL}/calendar`;
const VENUE_NAME = 'Soundpony';

// Tulsa, OK — Central Time.
// March–October = CDT (UTC−5), November–February = CST (UTC−6).
function getTulsaOffsetHours(date) {
  // Simple approximation: CDT starts second Sunday in March, ends first Sunday in November
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-based
  if (month > 3 && month < 11) return -5;
  if (month < 3 || month > 11) return -6;
  if (month === 3) {
    // CDT starts 2nd Sunday of March at 2am
    const secondSunday = getNthSundayOfMonth(year, 3, 2);
    return date.getUTCDate() >= secondSunday ? -5 : -6;
  }
  // month === 11: CST starts 1st Sunday of November at 2am
  const firstSunday = getNthSundayOfMonth(year, 11, 1);
  return date.getUTCDate() >= firstSunday ? -6 : -5;
}

function getNthSundayOfMonth(year, month, n) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const dow = d.getUTCDay(); // 0=Sun
  const firstSunday = dow === 0 ? 1 : 8 - dow;
  return firstSunday + (n - 1) * 7;
}

function toLocalDate(ms) {
  const utc = new Date(ms);
  const offset = getTulsaOffsetHours(utc);
  const local = new Date(ms + offset * 3600 * 1000);
  const y  = local.getUTCFullYear();
  const mo = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function toLocalTime(ms) {
  const utc = new Date(ms);
  const offset = getTulsaOffsetHours(utc);
  const local = new Date(ms + offset * 3600 * 1000);
  let h = local.getUTCHours();
  const m = String(local.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

export async function scrape() {
  const allEvents = [];
  const seenIds   = new Set();

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // Block heavy assets
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,css}', r => r.abort());

    // Intercept Squarespace calendar API responses
    page.on('response', async resp => {
      if (!resp.url().includes('GetItemsByMonth')) return;
      try {
        const body = await resp.text();
        const data = JSON.parse(body);
        for (const ev of data) {
          if (!seenIds.has(ev.id)) {
            seenIds.add(ev.id);
            allEvents.push(ev);
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    await page.goto(EVENTS_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Click next month to capture one more month of events.
    // The nav element may not be "visible" in Playwright's sense (rendered off-screen
    // in the YUI3 calendar header), so use dispatchEvent to bypass visibility checks.
    const nextBtn = await page.$('.yui3-calendarnav-nextmonth');
    if (nextBtn) {
      await nextBtn.dispatchEvent('click');
      await page.waitForTimeout(2000);
    }
  } finally {
    await browser.close();
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const shows = [];

  for (const ev of allEvents) {
    try {
      const title = (ev.title || '').trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      if (!title) continue;

      // Derive date from URL slug (encodes local date correctly)
      // e.g. /live-music/2026/3/28/slug → 2026-03-28
      let date = null;
      const urlMatch = (ev.fullUrl || '').match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//);
      if (urlMatch) {
        const [, y, m, d] = urlMatch;
        date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      } else if (ev.startDate) {
        date = toLocalDate(ev.startDate);
      }

      // Filter out past events
      if (date && date < today) continue;

      const time = ev.startDate ? toLocalTime(ev.startDate) : null;

      const hrefRaw  = ev.fullUrl || '';
      const eventUrl = hrefRaw
        ? (hrefRaw.startsWith('http') ? hrefRaw : `${BASE_URL}${hrefRaw}`)
        : EVENTS_URL;

      shows.push(
        normalizeShow({
          title,
          venue:       VENUE_NAME,
          venueUrl:    BASE_URL,
          date,
          time,
          price:       null,
          description: null,
          eventUrl,
          ageLimit:    null,
          tags:        ['tulsa'],
          imageUrl:    null,
        }),
      );
    } catch {
      // skip malformed entries
    }
  }

  // Sort ascending by date
  shows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return shows;
}
