/**
 * Shared validation logic for show data.
 *
 * Pure functions — no DB logging, no console output.
 * Used by: scraper/index.js (pipeline), agents/validator/index.js (full reports)
 */

// ── Schema validation ────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['title', 'venue', 'date'];
const DATE_FMT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FMT = /^\d{1,2}(:\d{2})?\s*[APap][Mm]$/;
const PRICE_FMT = /^(\$\d+|Free|free)/;

/**
 * Validate a single show object.
 * Returns { index, show, valid, errors, warnings }.
 */
export function validateShow(show, index = 0) {
    const errors = [];
    const warnings = [];

    // Required fields
    for (const field of REQUIRED_FIELDS) {
        if (!show[field] || (typeof show[field] === 'string' && !show[field].trim())) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    // Date format
    if (show.date && !DATE_FMT.test(show.date)) {
        errors.push(`Invalid date format: "${show.date}" (expected YYYY-MM-DD)`);
    }

    // Date sanity — not in the distant past or future
    if (show.date && DATE_FMT.test(show.date)) {
        const showDate = new Date(show.date + 'T12:00:00');
        const now = new Date();
        const daysDiff = (showDate - now) / (1000 * 60 * 60 * 24);

        if (daysDiff < -30) {
            warnings.push(`Date is ${Math.abs(Math.round(daysDiff))} days in the past`);
        }
        if (daysDiff > 365) {
            warnings.push(`Date is ${Math.round(daysDiff)} days in the future`);
        }
    }

    // Time format
    if (show.time && !TIME_FMT.test(show.time.trim())) {
        warnings.push(`Unusual time format: "${show.time}" (expected "H:MM AM/PM")`);
    }

    // Price format
    if (show.price && !PRICE_FMT.test(show.price)) {
        warnings.push(`Unusual price format: "${show.price}"`);
    }

    // Suspicious price values
    if (show.price) {
        const priceMatch = show.price.match(/\$(\d+)/);
        if (priceMatch) {
            const amount = parseInt(priceMatch[1], 10);
            if (amount > 500) {
                warnings.push(`Suspiciously high price: ${show.price}`);
            }
        }
    }

    // Title quality
    if (show.title === 'Unknown Show') {
        warnings.push('Title is placeholder "Unknown Show"');
    }
    if (show.title && show.title.length > 200) {
        warnings.push(`Title is unusually long (${show.title.length} chars)`);
    }

    // Venue quality
    if (show.venue === 'Unknown Venue') {
        errors.push('Venue is placeholder "Unknown Venue"');
    }

    // Type checks
    if (show.tags && !Array.isArray(show.tags)) {
        errors.push(`tags must be an array, got ${typeof show.tags}`);
    }

    return {
        index,
        show: { title: show.title, venue: show.venue, date: show.date },
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

// ── Duplicate detection ──────────────────────────────────────────────────────

/**
 * Find duplicate shows by venue+date+title key.
 * Returns array of { indices, key, show }.
 */
export function findDuplicates(shows) {
    const seen = new Map();
    const duplicates = [];

    for (let i = 0; i < shows.length; i++) {
        const show = shows[i];
        const key = [
            (show.venue || '').toLowerCase().trim(),
            show.date || '',
            (show.title || '').toLowerCase().trim(),
        ].join('||');

        if (seen.has(key)) {
            duplicates.push({
                indices: [seen.get(key), i],
                key,
                show: { title: show.title, venue: show.venue, date: show.date },
            });
        } else {
            seen.set(key, i);
        }
    }

    return duplicates;
}

// ── Batch validation ─────────────────────────────────────────────────────────

/**
 * Validate an array of shows. Returns { passed, rejected }.
 * passed: shows that have no errors
 * rejected: shows with errors, annotated with _rejectionReasons
 */
export function validateAll(shows) {
    const results = shows.map((show, i) => validateShow(show, i));
    const passed = [];
    const rejected = [];

    for (const r of results) {
        if (r.valid) {
            passed.push(shows[r.index]);
        } else {
            rejected.push({ ...shows[r.index], _rejectionReasons: r.errors });
        }
    }

    return { passed, rejected };
}
