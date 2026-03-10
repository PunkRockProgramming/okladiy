/**
 * Shared regex-based text parser for show listings.
 *
 * Single source of truth for all regex constants and parsing logic.
 * Used by: agents/parser, evals/parser.eval, evals/judge.eval
 */
import { parseDate, normalizePrice, normalizeShow } from './utils.js';

// ── Regex constants ──────────────────────────────────────────────────────────

export const DATE_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,.\s]+([a-z]+\.?\s+\d{1,2}(?:[,\s]+\d{4})?)/i;
export const DATE_RE_2 = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/;
// Date without day-of-week: "march 21st", "april 5"
export const DATE_RE_3 = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?\b/i;

export const TIME_RE = /(?:doors?\s*(?:@|at)?\s*|show\s*(?:@|at)?\s*|starts?\s*(?:@|at)?\s*)(\d{1,2}(?::\d{2})?\s*(?:am?|pm?))/i;
export const TIME_RE_2 = /\b(\d{1,2}(?::\d{2})?\s*(?:am?|pm?))\b/i;

export const PRICE_RE = /\$(\d+(?:\.\d{2})?)(?:\s*(?:adv(?:ance)?|in advance))?(?:\s*[\/|,\s]\s*\$(\d+(?:\.\d{2})?)\s*(?:dos|door|at the door|day of))?/i;
// Informal price: "10 bucks", "20 dollars"
export const PRICE_INFORMAL_RE = /\b(\d+)\s*(?:bucks?|dollars?)\b/i;
export const FREE_RE = /\b(free|no cover|free admission|free entry)\b/i;

// Age limits: "all ages", "18+", "21+", "AA", "18 and over", "21 and up"
export const AGE_RE = /\b(all\s*ages?|18\+|21\+|\baa\b|\d+\s+and\s+(?:over|up))/i;

// ── Multi-show splitting ─────────────────────────────────────────────────────

/**
 * Detect line-per-show patterns and split text into individual show blocks.
 * Patterns: "Fri 3/21 - PILE..." or "3/21 — Artist — $10" per line.
 * Returns array of text blocks (1 per show). If no multi-show pattern, returns [text].
 */
export function splitMultiShow(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Pattern: lines starting with abbreviated day + date ("Fri 3/21", "Sat 3/22")
    const dayDateRe = /^(mon|tue|wed|thu|fri|sat|sun)\w*\s+\d{1,2}[\/.-]\d{1,2}/i;
    const showLines = lines.filter(l => dayDateRe.test(l));

    if (showLines.length >= 2) {
        return showLines;
    }

    // Pattern: lines starting with a numeric date ("3/21 - PILE", "3/22 — Neon Indian")
    const numDateRe = /^\d{1,2}[\/.-]\d{1,2}\s*[-—]/;
    const numShowLines = lines.filter(l => numDateRe.test(l));

    if (numShowLines.length >= 2) {
        return numShowLines;
    }

    return [text];
}

// ── Core regex parser ────────────────────────────────────────────────────────

/**
 * Parse raw text into structured show fields using regex only.
 * Returns { date, time, price, ageLimit, title }.
 */
export function regexParse(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Try to find date
    let date = null;
    const dateMatch = text.match(DATE_RE);
    if (dateMatch) {
        date = parseDate(dateMatch[2].trim());
    }
    if (!date) {
        const dateMatch2 = text.match(DATE_RE_2);
        if (dateMatch2) {
            const [, m, d, y] = dateMatch2;
            const year = y.length === 2 ? `20${y}` : y;
            date = parseDate(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
        }
    }
    if (!date) {
        const dateMatch3 = text.match(DATE_RE_3);
        if (dateMatch3) {
            const [, month, day, year] = dateMatch3;
            const dateStr = year ? `${month} ${day}, ${year}` : `${month} ${day}`;
            date = parseDate(dateStr);
        }
    }

    // Try to find time — normalize abbreviated forms ("8p" → "8 PM", "730" → "7:30 PM")
    let time = null;
    const timeMatch = text.match(TIME_RE) || text.match(TIME_RE_2);
    if (timeMatch) {
        let raw = timeMatch[1].trim();
        // Normalize: "8p" → "8 PM", "8a" → "8 AM"
        raw = raw.replace(/([ap])$/i, (_, letter) => ` ${letter.toUpperCase()}M`);
        // Normalize: "8pm" → "8 PM"
        raw = raw.replace(/([ap]m)$/i, m => ` ${m.toUpperCase()}`);
        // Clean double spaces
        time = raw.replace(/\s+/g, ' ').trim();
    }

    // If no match and we see a bare "730" or "830" pattern near "doors" context
    if (!time) {
        const bareTimeMatch = text.match(/(?:doors?\s*(?:@|at)?\s*)(\d{3,4})\b/i);
        if (bareTimeMatch) {
            const digits = bareTimeMatch[1];
            const h = digits.length === 3 ? digits[0] : digits.slice(0, 2);
            const m = digits.length === 3 ? digits.slice(1) : digits.slice(2);
            const hour = parseInt(h, 10);
            const suffix = hour < 12 && hour >= 6 ? 'PM' : (hour < 6 ? 'AM' : 'PM');
            time = `${h}:${m} ${suffix}`;
        }
    }

    // Price
    let price = null;
    if (FREE_RE.test(text)) {
        price = 'Free';
    } else {
        const priceMatch = text.match(PRICE_RE);
        if (priceMatch) {
            if (priceMatch[2]) {
                price = `$${priceMatch[1]} adv / $${priceMatch[2]} door`;
            } else {
                price = `$${priceMatch[1]}`;
            }
        }
        // Fallback: informal price ("10 bucks", "20 dollars")
        if (!price) {
            const informalMatch = text.match(PRICE_INFORMAL_RE);
            if (informalMatch) {
                price = `$${informalMatch[1]}`;
            }
        }
    }

    // Age limit
    const ageMatch = text.match(AGE_RE);
    let ageLimit = null;
    if (ageMatch) {
        const raw = ageMatch[1].replace(/\s+/g, ' ').trim();
        if (/all\s*ages?/i.test(raw) || /^aa$/i.test(raw)) {
            ageLimit = 'All Ages';
        } else if (/(\d+)\s+and\s+(?:over|up)/i.test(raw)) {
            const num = raw.match(/(\d+)/)[1];
            ageLimit = `${num}+`;
        } else {
            ageLimit = raw;
        }
    }

    // Title: first meaningful line (strip emoji, hashtags, inline metadata)
    let title = lines[0] || 'Unknown Show';
    title = title
        .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .replace(/#\w+/g, '')
        .replace(/^[\s\-—|:]+/, '')
        .replace(/\s*\|.*$/g, '')
        .replace(/^(SHOW ALERT|EVENT|TONIGHT|THIS WEEKEND|THIS FRIDAY|UPCOMING SHOWS?[^:]*:?)\s*[-—:!\s]*/i, '')
        .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+[a-z]+\s+\d{1,2}\b.*/i, '')
        .trim();
    if ((!title || title.length < 3) && lines.length > 1) {
        title = lines[1].replace(/[\u{1F300}-\u{1FFFF}]/gu, '').replace(/#\w+/g, '').trim();
    }
    if (!title) title = lines[0] || 'Unknown Show';

    // For multi-show single-line format ("Fri 3/21 - PILE w/ Jank..."), extract title after date-separator
    if (title.match(/^(mon|tue|wed|thu|fri|sat|sun)\w*\s+\d{1,2}[\/.-]\d{1,2}\s*[-—]\s*/i)) {
        title = title.replace(/^(mon|tue|wed|thu|fri|sat|sun)\w*\s+\d{1,2}[\/.-]\d{1,2}\s*[-—]\s*/i, '');
        // Strip trailing metadata after " - $10" or " - doors"
        title = title.replace(/\s*[-—]\s*(?:\$|free|doors?|all\s*ages?|18\+|21\+|aa)\b.*/i, '').trim();
    }

    return { date, time, price, ageLimit, title };
}

// ── Regex parser with venue metadata + confidence ────────────────────────────

/**
 * Parse text with venue context. Returns { parsed, confidence, reason }.
 * Wraps regexParse + normalizeShow + confidence scoring.
 */
export function regexParseWithMeta(text, venueMeta) {
    const { date, time, price, ageLimit, title } = regexParse(text);

    // Confidence: how many fields did we extract?
    const fields = [date, time, price, ageLimit].filter(Boolean).length;
    const confidence = date ? (fields >= 3 ? 'high' : fields >= 2 ? 'medium' : 'low') : 'none';

    if (!date) return { parsed: null, confidence: 'none', reason: 'No date found in text' };

    return {
        parsed: normalizeShow({
            title,
            venue: venueMeta.name,
            venueUrl: venueMeta.url,
            date,
            time,
            price: price ? normalizePrice(price) : null,
            description: text.slice(0, 300).trim(),
            eventUrl: venueMeta.url,
            ageLimit,
            tags: [venueMeta.source || 'manual'],
        }),
        confidence,
    };
}
