/**
 * Sanctuary OKC Scraper
 *
 * Supports two modes:
 * 1. RSSHub feed (requires local RSSHub instance with Instagram session)
 * 2. Manual paste file fallback (scraper/data/sanctuary-manual.txt)
 *
 * The manual paste file should contain Instagram captions separated by
 * triple newlines or "---" dividers (same format as agents/parser input).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizeShow } from '../utils.js';
import { regexParse, splitMultiShow } from '../parse-text.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANUAL_FILE = join(__dirname, '../data/sanctuary-manual.txt');

const VENUE_META = {
    name: 'The Sanctuary',
    url: 'https://www.instagram.com/thesanctuaryokc/',
};

const RSSHUB_URL = process.env.RSSHUB_URL || 'http://localhost:1200';
const RSSHUB_FEED = `${RSSHUB_URL}/instagram/user/thesanctuaryokc`;

/**
 * Try RSSHub feed first, fall back to manual paste file.
 */
export async function scrape() {
    // Try RSSHub feed
    const rssShows = await tryRSSHub();
    if (rssShows !== null) return rssShows;

    // Fallback: manual paste file
    return parseManualFile();
}

async function tryRSSHub() {
    try {
        const res = await fetch(RSSHUB_FEED, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;

        const xml = await res.text();
        // Lazy XML extraction — grab <description> content from each <item>
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        const shows = [];

        for (const item of items) {
            const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
            if (!descMatch) continue;

            const text = descMatch[1]
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();

            const blocks = splitMultiShow(text);
            for (const block of blocks) {
                const parsed = regexParse(block);
                if (parsed.date) {
                    shows.push(normalizeShow({
                        ...parsed,
                        venue: VENUE_META.name,
                        venueUrl: VENUE_META.url,
                        eventUrl: VENUE_META.url,
                        tags: ['instagram', 'rsshub'],
                    }));
                }
            }
        }

        return shows;
    } catch {
        // RSSHub not available
        return null;
    }
}

function parseManualFile() {
    let text;
    try {
        text = readFileSync(MANUAL_FILE, 'utf-8').trim();
    } catch {
        return []; // No manual file
    }

    if (!text) return [];

    // Split on triple newlines or --- dividers
    const posts = text.split(/\n{3,}|---+/).map(p => p.trim()).filter(Boolean);
    const shows = [];

    for (const post of posts) {
        const blocks = splitMultiShow(post);
        for (const block of blocks) {
            const parsed = regexParse(block);
            if (parsed.date) {
                shows.push(normalizeShow({
                    ...parsed,
                    venue: VENUE_META.name,
                    venueUrl: VENUE_META.url,
                    eventUrl: VENUE_META.url,
                    tags: ['instagram', 'manual'],
                }));
            }
        }
    }

    return shows;
}
