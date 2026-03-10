#!/usr/bin/env node
/**
 * Scraper Agent
 *
 * Wraps existing scrapers with monitoring, failure detection, and SQLite logging.
 * Compares results against historical data to detect anomalies.
 *
 * Usage:
 *   node agents/scraper/index.js all              Run all scrapers with monitoring
 *   node agents/scraper/index.js beercity          Run a single scraper
 *   node agents/scraper/index.js health            Show scraper health report
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../lib/db.js';
import { SCRAPERS } from '../../scraper/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const SCRAPERS_DIR = join(PROJECT_ROOT, 'scraper/scrapers');

// Derive scraper names from the canonical SCRAPERS array
const SCRAPER_NAMES = SCRAPERS.map(s => s.name);

// ── Run a single scraper with monitoring ─────────────────────────────────────

async function runScraper(name, db) {
    const startedAt = new Date().toISOString();
    const start = Date.now();

    // Log run start
    const { lastInsertRowid: runId } = db.prepare(`
        INSERT INTO scraper_runs (venue, started_at, status)
        VALUES (?, ?, 'running')
    `).run(name, startedAt);

    try {
        // Dynamically import the scraper
        const modulePath = new URL(`../../scraper/scrapers/${name}.js`, import.meta.url).href;
        const { scrape } = await import(modulePath);

        const shows = await scrape();
        const durationMs = Date.now() - start;

        // Log success
        db.prepare(`
            UPDATE scraper_runs
            SET status = 'success', show_count = ?, finished_at = ?, duration_ms = ?
            WHERE id = ?
        `).run(shows.length, new Date().toISOString(), durationMs, runId);

        // Check for anomalies
        detectAnomalies(db, name, shows, runId);

        // Store show hashes for historical tracking
        const now = new Date().toISOString();
        const findExisting = db.prepare(`SELECT id, first_seen_at FROM shows WHERE hash = ?`);

        for (const show of shows) {
            const hash = [
                (show.venue || '').toLowerCase().trim(),
                show.date || '',
                (show.title || '').toLowerCase().trim(),
            ].join('||');

            const existing = findExisting.get(hash);
            if (existing) {
                db.prepare(`
                    UPDATE shows SET last_seen_at = ?, run_id = ? WHERE id = ?
                `).run(now, runId, existing.id);
            } else {
                db.prepare(`
                    INSERT INTO shows (run_id, venue, title, date, time, price, event_url, age_limit, description, hash, first_seen_at, last_seen_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(runId, show.venue, show.title, show.date, show.time, show.price, show.eventUrl, show.ageLimit, show.description, hash, now, now);
            }
        }

        return { name, status: 'success', showCount: shows.length, durationMs, shows };

    } catch (err) {
        const durationMs = Date.now() - start;

        // Classify the error
        const errorType = classifyError(err);

        db.prepare(`
            UPDATE scraper_runs
            SET status = 'failure', error_message = ?, finished_at = ?, duration_ms = ?
            WHERE id = ?
        `).run(`[${errorType}] ${err.message}`, new Date().toISOString(), durationMs, runId);

        // Log anomaly for failure
        db.prepare(`
            INSERT INTO anomalies (detected_at, agent, type, venue, severity, message, data)
            VALUES (?, 'scraper', ?, ?, 'error', ?, ?)
        `).run(
            new Date().toISOString(),
            errorType === 'network' ? 'stale_venue' : 'parse_failure',
            name,
            `Scraper "${name}" failed: ${err.message}`,
            JSON.stringify({ errorType, stack: err.stack?.split('\n').slice(0, 5) })
        );

        return { name, status: 'failure', error: err.message, errorType, durationMs };
    }
}

// ── Error classification ─────────────────────────────────────────────────────

function classifyError(err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('timeout') || msg.includes('socket hang up')) {
        return 'network';
    }
    if (msg.includes('http 4') || msg.includes('http 5')) {
        return 'http';
    }
    if (msg.includes('cannot read') || msg.includes('undefined') || msg.includes('null')) {
        return 'selector_drift';
    }
    return 'unknown';
}

// ── Anomaly detection ────────────────────────────────────────────────────────

function detectAnomalies(db, venue, shows, runId) {
    const now = new Date().toISOString();

    // Check 1: Zero shows returned
    if (shows.length === 0) {
        db.prepare(`
            INSERT INTO anomalies (detected_at, agent, type, venue, severity, message, data)
            VALUES (?, 'scraper', 'count_drop', ?, 'warning', ?, ?)
        `).run(now, venue, `Scraper "${venue}" returned 0 shows`, JSON.stringify({ runId }));
        return;
    }

    // Check 2: Significant count drop vs previous run
    const prevRun = db.prepare(`
        SELECT show_count FROM scraper_runs
        WHERE venue = ? AND status = 'success' AND id < ?
        ORDER BY id DESC LIMIT 1
    `).get(venue, runId);

    if (prevRun && prevRun.show_count > 0) {
        const dropPct = 1 - (shows.length / prevRun.show_count);
        if (dropPct > 0.5) {
            db.prepare(`
                INSERT INTO anomalies (detected_at, agent, type, venue, severity, message, data)
                VALUES (?, 'scraper', 'count_drop', ?, 'warning', ?, ?)
            `).run(
                now, venue,
                `Show count dropped ${Math.round(dropPct * 100)}%: ${prevRun.show_count} → ${shows.length}`,
                JSON.stringify({ previous: prevRun.show_count, current: shows.length, runId })
            );
        }
    }

    // Check 3: Shows with missing required fields
    const incomplete = shows.filter(s => !s.title || !s.venue || !s.date);
    if (incomplete.length > 0) {
        db.prepare(`
            INSERT INTO anomalies (detected_at, agent, type, venue, severity, message, data)
            VALUES (?, 'scraper', 'schema_violation', ?, 'warning', ?, ?)
        `).run(
            now, venue,
            `${incomplete.length} show(s) missing required fields (title/venue/date)`,
            JSON.stringify({ count: incomplete.length, samples: incomplete.slice(0, 3) })
        );
    }
}

// ── Health report ────────────────────────────────────────────────────────────

function showHealth() {
    const db = getDb();

    console.log('\n╔══════════════════════════════════════╗');
    console.log('║       Scraper Health Report          ║');
    console.log('╚══════════════════════════════════════╝\n');

    // Latest run per venue
    const runs = db.prepare(`
        SELECT venue, status, show_count, started_at, duration_ms, error_message
        FROM scraper_runs
        WHERE id IN (SELECT MAX(id) FROM scraper_runs GROUP BY venue)
        ORDER BY venue
    `).all();

    if (runs.length === 0) {
        console.log('  No runs recorded yet. Run: node agents/scraper/index.js all\n');
    } else {
        for (const run of runs) {
            const icon = run.status === 'success' ? '✅' : '❌';
            const duration = run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '?';
            console.log(`  ${icon} ${run.venue.padEnd(18)} ${String(run.show_count ?? 0).padStart(3)} shows  ${duration.padStart(6)}  ${run.started_at.split('T')[0]}`);
            if (run.error_message) {
                console.log(`     └─ ${run.error_message}`);
            }
        }
    }

    // Venues with no runs
    const runVenues = new Set(runs.map(r => r.venue));
    const missing = SCRAPER_NAMES.filter(n => !runVenues.has(n));
    if (missing.length > 0) {
        console.log(`\n  ⚠️  Never run: ${missing.join(', ')}`);
    }

    // Open anomalies
    const anomalies = db.prepare(`
        SELECT type, venue, severity, message FROM anomalies WHERE resolved = 0 ORDER BY detected_at DESC LIMIT 10
    `).all();

    if (anomalies.length > 0) {
        console.log(`\n  ⚠️  Open anomalies (${anomalies.length}):`);
        for (const a of anomalies) {
            const icon = a.severity === 'error' ? '🔴' : '🟡';
            console.log(`    ${icon} [${a.venue || 'global'}] ${a.message}`);
        }
    }

    // Run stats
    const stats = db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
               SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure
        FROM scraper_runs
    `).get();

    console.log(`\n  📊 Total runs: ${stats.total} (${stats.success} success, ${stats.failure} failure)`);

    // Show count in DB
    const showStats = db.prepare(`SELECT COUNT(DISTINCT hash) as unique_shows FROM shows`).get();
    console.log(`  📊 Unique shows tracked: ${showStats.unique_shows}`);

    console.log();
    db.close();
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const arg = process.argv[2] || 'health';

if (arg === 'health') {
    showHealth();
} else if (arg === 'all') {
    const db = getDb();
    console.log(`\n🔧 Scraper Agent — running ${SCRAPER_NAMES.length} scrapers\n`);
    const results = [];

    for (const name of SCRAPER_NAMES) {
        process.stdout.write(`  ${name}... `);
        const result = await runScraper(name, db);
        if (result.status === 'success') {
            console.log(`✅ ${result.showCount} shows (${(result.durationMs / 1000).toFixed(1)}s)`);
        } else {
            console.log(`❌ ${result.errorType}: ${result.error}`);
        }
        results.push(result);
    }

    db.close();

    const successes = results.filter(r => r.status === 'success');
    const failures = results.filter(r => r.status === 'failure');
    const totalShows = successes.reduce((sum, r) => sum + r.showCount, 0);

    console.log(`\n📊 ${successes.length}/${results.length} succeeded, ${totalShows} total shows`);
    if (failures.length > 0) {
        console.log(`❌ Failed: ${failures.map(f => f.name).join(', ')}`);
    }
    console.log();
} else {
    // Single scraper
    if (!SCRAPER_NAMES.includes(arg)) {
        console.error(`Unknown scraper: ${arg}`);
        console.error(`Available: ${SCRAPER_NAMES.join(', ')}`);
        process.exit(1);
    }

    const db = getDb();
    console.log(`\n🔧 Running scraper: ${arg}\n`);
    const result = await runScraper(arg, db);
    db.close();

    if (result.status === 'success') {
        console.log(`✅ ${result.showCount} shows in ${(result.durationMs / 1000).toFixed(1)}s`);
        for (const show of result.shows) {
            console.log(`  ${show.date} | ${show.title} | ${show.venue}`);
        }
    } else {
        console.log(`❌ [${result.errorType}] ${result.error}`);
    }
    console.log();
}
