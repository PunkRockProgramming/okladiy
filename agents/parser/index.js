#!/usr/bin/env node
/**
 * Parser Agent
 *
 * Normalizes raw text (HTML extracts or social media captions) into
 * structured show objects matching the OKDIY schema. Uses regex for
 * well-structured content and Claude for fuzzy/ambiguous text.
 *
 * Usage:
 *   node agents/parser/index.js --venue=sanctuary --input=captions.txt
 *   node agents/parser/index.js --venue=sanctuary --text="SHOW ALERT — Friday March 14..."
 *   echo "post text" | node agents/parser/index.js --venue=sanctuary
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { askWithTools } from '../lib/claude.js';
import { normalizePrice, normalizeShow } from '../../scraper/utils.js';
import { regexParseWithMeta } from '../../scraper/parse-text.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Venue metadata ───────────────────────────────────────────────────────────

const VENUES = {
    sanctuary: {
        name: 'The Sanctuary',
        city: 'Oklahoma City',
        url: 'https://www.instagram.com/thesanctuaryokc/',
        source: 'instagram',
    },
    // Add more Instagram-only or social-media-only venues here
};

// ── Claude-based parsing (fallback for ambiguous text) ───────────────────────

const PARSE_TOOL = {
    name: 'extract_shows',
    description: 'Extract structured show/event data from text',
    input_schema: {
        type: 'object',
        required: ['shows'],
        properties: {
            shows: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['title', 'date'],
                    properties: {
                        title: { type: 'string', description: 'Artist/event name' },
                        date: { type: 'string', description: 'ISO date: YYYY-MM-DD' },
                        time: { type: ['string', 'null'], description: 'e.g. "8:00 PM"' },
                        price: { type: ['string', 'null'], description: 'e.g. "$15", "Free"' },
                        ageLimit: { type: ['string', 'null'], description: 'e.g. "All Ages", "21+"' },
                        description: { type: ['string', 'null'], description: 'Supporting acts, notes' },
                    },
                },
            },
        },
    },
};

const PARSER_SYSTEM = `You are a show listing parser for OKDIY, an OKC/Tulsa concert aggregator.

Extract structured event data from social media posts and unstructured text. Each post may contain one or more show announcements.

Rules:
- Dates MUST be ISO format (YYYY-MM-DD). If no year, assume current year (2026). If the date is in the past, bump to next year.
- Times should be in "H:MM AM/PM" format
- Prices: "$15", "$10 adv / $15 door", "Free"
- Only extract events that are clearly show/concert announcements — skip general venue posts, memes, or non-event content
- If a post announces multiple shows on different dates, return one object per show
- If you cannot confidently determine the date, skip that show entirely`;

async function claudeParse(text, venueMeta) {
    const userMessage = `Parse show listings from this ${venueMeta.source || 'social media'} post by ${venueMeta.name} (${venueMeta.city}):\n\n---\n${text}\n---`;

    const response = await askWithTools(PARSER_SYSTEM, userMessage, [PARSE_TOOL], {
        toolChoice: { type: 'tool', name: 'extract_shows' },
        maxTokens: 2048,
    });

    const toolUse = response.content.find(b => b.type === 'tool_use');
    if (!toolUse) return [];

    return toolUse.input.shows.map(show => normalizeShow({
        title: show.title,
        venue: venueMeta.name,
        venueUrl: venueMeta.url,
        date: show.date,
        time: show.time || null,
        price: show.price ? normalizePrice(show.price) : null,
        description: show.description || text.slice(0, 300).trim(),
        eventUrl: venueMeta.url,
        ageLimit: show.ageLimit || null,
        tags: [venueMeta.source || 'manual', 'ai-parsed'],
    }));
}

// ── Main parse pipeline ──────────────────────────────────────────────────────

async function parseText(text, venueMeta) {
    // Split on common post separators (multiple shows in one paste)
    const posts = text.split(/\n{3,}|---+/).map(p => p.trim()).filter(Boolean);
    const results = [];

    for (const post of posts) {
        // Try regex first
        const { parsed, confidence, reason } = regexParseWithMeta(post, venueMeta);

        if (confidence === 'high' || confidence === 'medium') {
            results.push({ ...parsed, _parseMethod: 'regex', _confidence: confidence });
        } else if (confidence === 'low' && parsed) {
            // Low confidence regex — try Claude for better extraction
            console.log(`  ⚠️  Low confidence regex parse, trying Claude...`);
            const claudeShows = await claudeParse(post, venueMeta);
            if (claudeShows.length > 0) {
                results.push(...claudeShows.map(s => ({ ...s, _parseMethod: 'claude', _confidence: 'ai' })));
            } else {
                // Fall back to regex result
                results.push({ ...parsed, _parseMethod: 'regex', _confidence: 'low' });
            }
        } else {
            // No date found via regex — try Claude
            console.log(`  🤖 Regex found no date, trying Claude...`);
            const claudeShows = await claudeParse(post, venueMeta);
            if (claudeShows.length > 0) {
                results.push(...claudeShows.map(s => ({ ...s, _parseMethod: 'claude', _confidence: 'ai' })));
            } else {
                console.log(`  ⏭️  Skipping non-event post`);
            }
        }
    }

    return results;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {};
for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) flags[match[1]] = match[2];
}

const venueName = flags.venue;
if (!venueName) {
    console.error('Usage: node agents/parser/index.js --venue=NAME [--input=FILE | --text="..."]');
    console.error(`Available venues: ${Object.keys(VENUES).join(', ')}`);
    process.exit(1);
}

const venueMeta = VENUES[venueName];
if (!venueMeta) {
    console.error(`Unknown venue: ${venueName}`);
    console.error(`Available: ${Object.keys(VENUES).join(', ')}`);
    process.exit(1);
}

// Get input text
let inputText;
if (flags.input) {
    inputText = readFileSync(flags.input, 'utf-8');
} else if (flags.text) {
    inputText = flags.text;
} else if (!process.stdin.isTTY) {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    inputText = Buffer.concat(chunks).toString('utf-8');
} else {
    console.error('Provide input via --input=FILE, --text="...", or stdin');
    process.exit(1);
}

console.log(`\n🔍 Parser Agent — parsing ${venueName} content\n`);

const shows = await parseText(inputText, venueMeta);

if (shows.length === 0) {
    console.log('No shows extracted from input.\n');
} else {
    console.log(`✅ Extracted ${shows.length} show(s):\n`);
    for (const show of shows) {
        const method = show._parseMethod === 'claude' ? '🤖' : '📐';
        console.log(`  ${method} ${show.date} | ${show.title} | ${show.time || 'TBA'} | ${show.price || 'TBA'}`);
    }

    // Output clean JSON (strip internal metadata)
    const clean = shows.map(({ _parseMethod, _confidence, ...show }) => show);
    console.log(`\n--- JSON output ---`);
    console.log(JSON.stringify(clean, null, 2));
}
console.log();
