import fetch from 'node-fetch';
import { parse, parseISO, isValid, format } from 'date-fns';

// ── HTTP ─────────────────────────────────────────────────────────────────────

/** Random delay between min–max ms to avoid hammering sites */
export function delay(min = 300, max = 900) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch HTML with a polite User-Agent and optional delay.
 * Returns the response text or throws on non-2xx.
 */
export async function fetchHtml(url, { delayMs = true } = {}) {
  if (delayMs) await delay();
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; okladiy-scraper/1.0; +https://github.com/local/okladiy)',
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// ── DATE PARSING ─────────────────────────────────────────────────────────────

// Formats to try in order — add more as you encounter them in the wild
const DATE_FORMATS = [
  'yyyy-MM-dd',
  'MM/dd/yyyy',
  'M/d/yyyy',
  'MMMM d, yyyy',
  'MMM d, yyyy',
  'EEEE, MMMM d, yyyy',
  'EEEE, MMM d, yyyy',
  'EEEE, MMMM d', // "Thursday, February 26" — no year
  'EEEE, MMM d',  // "Thu, Feb 26"
  'MMMM d',       // no year — will use current/next year heuristic
  'MMM d',
  'EEE MMM d',
];

/**
 * Parse a messy date string into an ISO 8601 date string ("2026-03-14").
 * Returns null if parsing fails.
 *
 * Pass `referenceYear` (default: current year) to resolve year-less formats.
 */
export function parseDate(raw, referenceYear = new Date().getFullYear()) {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const d = parseISO(cleaned);
    return isValid(d) ? format(d, 'yyyy-MM-dd') : null;
  }

  // Try each format
  for (const fmt of DATE_FORMATS) {
    const refDate = new Date(referenceYear, 0, 1);
    const d = parse(cleaned, fmt, refDate);
    if (isValid(d)) {
      // If no year in format, pick current or next year so we never show past dates
      // (venues typically only post upcoming shows)
      const result = new Date(d);
      if (!fmt.includes('y')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (result < today) result.setFullYear(result.getFullYear() + 1);
      }
      return format(result, 'yyyy-MM-dd');
    }
  }

  return null;
}

// ── PRICE NORMALIZATION ───────────────────────────────────────────────────────

/**
 * Normalize price strings to a consistent format.
 * "15.00" → "$15"   "free" → "Free"   "$10-$15" → "$10–$15"
 */
export function normalizePrice(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === 'free' || s === 'free admission' || s === '0' || s === '$0') return 'Free';

  // Strip trailing .00
  return raw
    .trim()
    .replace(/\.00\b/g, '')
    .replace(/-/g, '–') // em dash range
    .replace(/^\$?(\d)/, '$$$1'); // ensure leading $
}

// ── DEDUPLICATION ─────────────────────────────────────────────────────────────

/**
 * Remove duplicate shows. Two shows are considered duplicates if they share
 * the same venue + date + normalized title.
 */
export function dedup(shows) {
  const seen = new Set();
  return shows.filter((show) => {
    const key = [
      (show.venue || '').toLowerCase().trim(),
      show.date || '',
      (show.title || '').toLowerCase().trim(),
    ].join('||');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── SHOW SCHEMA ───────────────────────────────────────────────────────────────

/**
 * Validate and fill defaults so every show object is well-formed.
 * Call this at the end of every scraper on each item.
 */
export function normalizeShow(partial) {
  return {
    title: partial.title?.trim() || 'Unknown Show',
    venue: partial.venue?.trim() || 'Unknown Venue',
    venueUrl: partial.venueUrl || null,
    date: partial.date || null,
    time: partial.time?.trim() || null,
    price: partial.price ? normalizePrice(partial.price) : null,
    description: partial.description?.trim() || null,
    eventUrl: partial.eventUrl || null,
    ageLimit: partial.ageLimit?.trim() || null,
    tags: Array.isArray(partial.tags) ? partial.tags : [],
  };
}
