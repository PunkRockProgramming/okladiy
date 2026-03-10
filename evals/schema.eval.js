#!/usr/bin/env node
/**
 * Schema Compliance Eval
 *
 * Tests the validator agent's per-show validation logic against
 * known-good and known-bad show objects.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import validator's validateShow directly
// (it's not exported, so we inline the logic — or we refactor later)
const REQUIRED_FIELDS = ['title', 'venue', 'date'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}(:\d{2})?\s*[APap][Mm]$/;
const PRICE_RE = /^(\$\d+|Free|free)/;

function validateShow(show) {
    const errors = [];
    const warnings = [];

    for (const field of REQUIRED_FIELDS) {
        if (!show[field] || (typeof show[field] === 'string' && !show[field].trim())) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    if (show.date && !DATE_RE.test(show.date)) {
        errors.push(`Invalid date format: "${show.date}"`);
    }

    if (show.date && DATE_RE.test(show.date)) {
        const showDate = new Date(show.date + 'T12:00:00');
        const now = new Date();
        const daysDiff = (showDate - now) / (1000 * 60 * 60 * 24);
        if (daysDiff < -30) warnings.push('past date');
        if (daysDiff > 365) warnings.push('far future date');
    }

    if (show.time && !TIME_RE.test(show.time.trim())) {
        warnings.push(`Unusual time format: "${show.time}"`);
    }

    if (show.price && !PRICE_RE.test(show.price)) {
        warnings.push(`Unusual price format: "${show.price}"`);
    }

    if (show.price) {
        const m = show.price.match(/\$(\d+)/);
        if (m && parseInt(m[1], 10) > 500) warnings.push('high price');
    }

    if (show.title === 'Unknown Show') warnings.push('placeholder title');
    if (show.venue === 'Unknown Venue') errors.push('placeholder venue');
    if (show.tags && !Array.isArray(show.tags)) errors.push('tags not array');

    return { valid: errors.length === 0, errors, warnings };
}

// ── Run eval ─────────────────────────────────────────────────────────────────

const cases = JSON.parse(readFileSync(join(__dirname, 'fixtures/schema-cases.json'), 'utf-8'));

let passed = 0;
let failed = 0;
const failures = [];

for (const tc of cases) {
    const result = validateShow(tc.show);
    let ok = true;
    const reasons = [];

    // Check validity
    if (result.valid !== tc.expectValid) {
        ok = false;
        reasons.push(`expected valid=${tc.expectValid}, got valid=${result.valid} (errors: ${result.errors.join(', ')})`);
    }

    // Check error fields (if specified)
    if (tc.expectErrors) {
        for (const field of tc.expectErrors) {
            const hasError = result.errors.some(e => e.toLowerCase().includes(field));
            if (!hasError) {
                ok = false;
                reasons.push(`expected error mentioning "${field}", got: ${result.errors.join('; ') || 'none'}`);
            }
        }
    }

    // Check warning count (if specified)
    if (tc.expectWarnings !== undefined) {
        if (result.warnings.length < tc.expectWarnings) {
            ok = false;
            reasons.push(`expected >= ${tc.expectWarnings} warning(s), got ${result.warnings.length}`);
        }
    }

    if (ok) {
        passed++;
        process.stdout.write(`  ✅ ${tc.id}\n`);
    } else {
        failed++;
        process.stdout.write(`  ❌ ${tc.id}\n`);
        for (const r of reasons) {
            console.log(`     └─ ${r}`);
        }
        failures.push({ id: tc.id, reasons });
    }
}

console.log(`\n📊 Schema eval: ${passed}/${cases.length} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
