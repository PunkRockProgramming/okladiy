#!/usr/bin/env node
/**
 * Parser Accuracy Eval
 *
 * Tests the parser agent's regex extraction against known inputs
 * with expected outputs. Deterministic — no Claude calls.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizePrice } from '../scraper/utils.js';
import { regexParse } from '../scraper/parse-text.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Run eval ─────────────────────────────────────────────────────────────────

const cases = JSON.parse(readFileSync(join(__dirname, 'fixtures/parser-cases.json'), 'utf-8'));

let passed = 0;
let failed = 0;
const failures = [];

for (const tc of cases) {
    const result = regexParse(tc.input);
    let ok = true;
    const reasons = [];

    if (tc.expected === null) {
        // Should not produce a show (no date)
        if (result.date !== null) {
            ok = false;
            reasons.push(`expected no date, got "${result.date}"`);
        }
    } else {
        // Check each expected field
        if (tc.expected.date !== undefined && result.date !== tc.expected.date) {
            ok = false;
            reasons.push(`date: expected "${tc.expected.date}", got "${result.date}"`);
        }

        if (tc.expected.time !== undefined && result.time !== tc.expected.time) {
            ok = false;
            reasons.push(`time: expected "${tc.expected.time}", got "${result.time}"`);
        }

        if (tc.expected.price !== undefined) {
            const normalizedResult = result.price ? normalizePrice(result.price) : null;
            const normalizedExpected = tc.expected.price ? normalizePrice(tc.expected.price) : null;
            // Compare both raw and normalized
            if (result.price !== tc.expected.price && normalizedResult !== normalizedExpected) {
                ok = false;
                reasons.push(`price: expected "${tc.expected.price}", got "${result.price}"`);
            }
        }

        if (tc.expected.ageLimit !== undefined && result.ageLimit !== tc.expected.ageLimit) {
            ok = false;
            reasons.push(`ageLimit: expected "${tc.expected.ageLimit}", got "${result.ageLimit}"`);
        }

        if (tc.expected.hasTitle && (!result.title || result.title === 'Unknown Show')) {
            ok = false;
            reasons.push(`expected a title, got "${result.title}"`);
        }
    }

    if (ok) {
        passed++;
        process.stdout.write(`  ✅ ${tc.id}: ${tc.description}\n`);
    } else {
        failed++;
        process.stdout.write(`  ❌ ${tc.id}: ${tc.description}\n`);
        for (const r of reasons) {
            console.log(`     └─ ${r}`);
        }
        failures.push({ id: tc.id, reasons });
    }
}

console.log(`\n📊 Parser eval: ${passed}/${cases.length} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
