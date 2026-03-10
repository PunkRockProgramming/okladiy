#!/usr/bin/env node
/**
 * Validator Agent
 *
 * Quality gate for show data. Validates schema compliance, detects anomalies,
 * and compares against historical data.
 *
 * Usage:
 *   node agents/validator/index.js --input=shows.json       Validate a shows file
 *   node agents/validator/index.js --scraper=beercity        Validate latest scraper output
 *   node agents/validator/index.js report                    Full data quality report
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../lib/db.js';

import { validateShow, findDuplicates } from '../../scraper/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const SHOWS_JSON = join(PROJECT_ROOT, 'docs/shows.json');

// ── Cross-venue anomalies ────────────────────────────────────────────────────

function detectCrossVenueAnomalies(shows) {
    const anomalies = [];

    // Group by venue
    const byVenue = {};
    for (const show of shows) {
        const v = show.venue || 'unknown';
        if (!byVenue[v]) byVenue[v] = [];
        byVenue[v].push(show);
    }

    // Check for venues with suspiciously few shows
    for (const [venue, venueShows] of Object.entries(byVenue)) {
        if (venueShows.length === 1) {
            anomalies.push({
                type: 'low_count',
                severity: 'info',
                message: `${venue} has only 1 show — could be a scraper issue`,
            });
        }
    }

    // Check for date clustering (many shows on same date across venues = possible data issue)
    const byDate = {};
    for (const show of shows) {
        if (show.date) {
            if (!byDate[show.date]) byDate[show.date] = [];
            byDate[show.date].push(show);
        }
    }

    for (const [date, dateShows] of Object.entries(byDate)) {
        if (dateShows.length > 15) {
            anomalies.push({
                type: 'date_clustering',
                severity: 'info',
                message: `${dateShows.length} shows on ${date} — unusually high density`,
            });
        }
    }

    return anomalies;
}

// ── Historical comparison ────────────────────────────────────────────────────

function compareWithHistory(shows) {
    const db = getDb();
    const anomalies = [];

    // Get venues that had shows historically but not in current data
    const currentVenues = new Set(shows.map(s => s.venue));

    const historicalVenues = db.prepare(`
        SELECT DISTINCT venue FROM shows WHERE last_seen_at > datetime('now', '-30 days')
    `).all().map(r => r.venue);

    for (const venue of historicalVenues) {
        if (!currentVenues.has(venue)) {
            anomalies.push({
                type: 'venue_disappeared',
                severity: 'warning',
                venue,
                message: `${venue} had shows in the last 30 days but none in current data`,
            });
        }
    }

    db.close();
    return anomalies;
}

// ── Validate a set of shows ──────────────────────────────────────────────────

function validate(shows) {
    console.log(`\n🔍 Validator Agent — checking ${shows.length} shows\n`);

    // Per-show validation
    const results = shows.map((show, i) => validateShow(show, i));
    const valid = results.filter(r => r.valid);
    const invalid = results.filter(r => !r.valid);
    const withWarnings = results.filter(r => r.warnings.length > 0);

    // Duplicates
    const dupes = findDuplicates(shows);

    // Cross-venue
    const crossAnomalies = detectCrossVenueAnomalies(shows);

    // Historical
    let histAnomalies = [];
    try {
        histAnomalies = compareWithHistory(shows);
    } catch {
        // DB might not have data yet
    }

    // Print results
    console.log(`  ✅ Valid:    ${valid.length}/${shows.length}`);
    console.log(`  ❌ Invalid:  ${invalid.length}/${shows.length}`);
    console.log(`  ⚠️  Warnings: ${withWarnings.length}/${shows.length}`);
    console.log(`  🔄 Duplicates: ${dupes.length}`);

    if (invalid.length > 0) {
        console.log(`\n  ❌ Validation errors:`);
        for (const r of invalid) {
            console.log(`    [${r.index}] ${r.show.venue} / ${r.show.date} / ${r.show.title}`);
            for (const e of r.errors) {
                console.log(`         🔴 ${e}`);
            }
        }
    }

    if (withWarnings.length > 0 && withWarnings.length <= 20) {
        console.log(`\n  ⚠️  Warnings:`);
        for (const r of withWarnings) {
            console.log(`    [${r.index}] ${r.show.venue} / ${r.show.date} / ${r.show.title}`);
            for (const w of r.warnings) {
                console.log(`         🟡 ${w}`);
            }
        }
    } else if (withWarnings.length > 20) {
        console.log(`\n  ⚠️  ${withWarnings.length} warnings (showing first 10):`);
        for (const r of withWarnings.slice(0, 10)) {
            console.log(`    [${r.index}] ${r.show.venue} — ${r.warnings[0]}`);
        }
    }

    if (dupes.length > 0) {
        console.log(`\n  🔄 Duplicates:`);
        for (const d of dupes) {
            console.log(`    ${d.show.venue} / ${d.show.date} / ${d.show.title} (indices ${d.indices.join(', ')})`);
        }
    }

    if (crossAnomalies.length > 0 || histAnomalies.length > 0) {
        console.log(`\n  📊 Anomalies:`);
        for (const a of [...crossAnomalies, ...histAnomalies]) {
            const icon = a.severity === 'warning' ? '🟡' : 'ℹ️';
            console.log(`    ${icon} ${a.message}`);
        }
    }

    // Log anomalies to DB
    const db = getDb();
    const now = new Date().toISOString();

    for (const r of invalid) {
        db.prepare(`
            INSERT INTO anomalies (detected_at, agent, type, venue, severity, message, data)
            VALUES (?, 'validator', 'schema_violation', ?, 'error', ?, ?)
        `).run(now, r.show.venue, r.errors.join('; '), JSON.stringify(r));
    }

    for (const a of [...crossAnomalies, ...histAnomalies]) {
        db.prepare(`
            INSERT INTO anomalies (detected_at, agent, type, venue, severity, message, data)
            VALUES (?, 'validator', ?, ?, ?, ?, ?)
        `).run(now, a.type, a.venue || null, a.severity, a.message, JSON.stringify(a));
    }

    db.close();

    // Return clean results
    const passed = valid.map(r => shows[r.index]);
    const rejected = invalid.map(r => ({ ...shows[r.index], _rejectionReasons: r.errors }));

    console.log(`\n  📤 ${passed.length} shows passed, ${rejected.length} rejected\n`);

    return { passed, rejected, warnings: withWarnings.length, duplicates: dupes.length };
}

// ── Full report on shows.json ────────────────────────────────────────────────

function fullReport() {
    let data;
    try {
        data = JSON.parse(readFileSync(SHOWS_JSON, 'utf-8'));
    } catch {
        console.error(`Cannot read ${SHOWS_JSON}`);
        process.exit(1);
    }

    console.log(`\n📋 Validating shows.json (last updated: ${data.lastUpdated})`);

    if (data.scraperErrors?.length > 0) {
        console.log(`\n  ⚠️  Scraper errors from last run:`);
        for (const e of data.scraperErrors) {
            console.log(`    ❌ ${e.scraper}: ${e.error}`);
        }
    }

    validate(data.shows || []);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {};
for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) flags[match[1]] = match[2];
}

if (args[0] === 'report' || args.length === 0) {
    fullReport();
} else if (flags.input) {
    const data = JSON.parse(readFileSync(flags.input, 'utf-8'));
    const shows = Array.isArray(data) ? data : data.shows || [];
    validate(shows);
} else {
    console.error('Usage:');
    console.error('  node agents/validator/index.js report              Validate docs/shows.json');
    console.error('  node agents/validator/index.js --input=FILE.json   Validate a custom file');
    process.exit(1);
}
