#!/usr/bin/env node
/**
 * LLM-as-Judge Eval
 *
 * Uses Claude to evaluate parser output quality on ambiguous/tricky inputs
 * where deterministic comparison isn't sufficient. Grades each parse on
 * accuracy, completeness, and title quality.
 *
 * Usage:
 *   node evals/judge.eval.js                Run all judge cases
 *   node evals/judge.eval.js --verbose      Show full judge reasoning
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { askWithTools } from '../agents/lib/claude.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('--verbose');

// ── Import shared parser logic ───────────────────────────────────────────────

import { regexParse } from '../scraper/parse-text.js';

// ── Judge cases — harder/ambiguous inputs ────────────────────────────────────

const JUDGE_CASES = [
    {
        id: 'messy-formatting',
        input: `🎶🎶🎶
THIS FRIDAY!!!
march 21st
PILE
with Jank and Algae Bloom
doors @ 730
10 bucks
all ages baby!!!
📍 the sanctuary okc
#oklahoma #punk #livemusic`,
    },
    {
        id: 'multiple-shows-one-post',
        input: `UPCOMING SHOWS AT THE SANCTUARY:

Fri 3/21 - PILE w/ Jank, Algae Bloom - $10 - doors 7:30
Sat 3/22 - Neon Indian - $15/$20 - doors 8pm - 21+
Wed 3/26 - Open Mic Night - FREE - 7pm - all ages`,
    },
    {
        id: 'abbreviated-everything',
        input: `sat apr 5 // REMI WOLF // sanctuary okc // 8p doors // $22 adv $28 dos // AA`,
    },
    {
        id: 'story-style-post',
        input: `We are SO excited to announce that JAPANESE BREAKFAST will be playing The Sanctuary on Friday, April 18th! Doors open at 7, show starts at 8. Tickets are $25 in advance and $30 at the door. This show is 18 and over. Don't miss this one, OKC!`,
    },
    {
        id: 'vague-time',
        input: `WEDNESDAY APRIL 9
DJ NIGHT @ THE SANCTUARY
LATE NIGHT VIBES
NO COVER
21+`,
    },
];

// ── Judge tool ───────────────────────────────────────────────────────────────

const JUDGE_TOOL = {
    name: 'grade_parse',
    description: 'Grade the quality of a parser\'s extraction from a social media post',
    input_schema: {
        type: 'object',
        required: ['date_correct', 'time_correct', 'price_correct', 'age_correct', 'title_quality', 'overall_grade', 'reasoning'],
        properties: {
            date_correct: { type: 'boolean', description: 'Was the date extracted correctly?' },
            time_correct: { type: 'string', enum: ['correct', 'acceptable', 'wrong', 'missing_ok', 'missing_bad'], description: 'Time extraction quality' },
            price_correct: { type: 'string', enum: ['correct', 'acceptable', 'wrong', 'missing_ok', 'missing_bad'], description: 'Price extraction quality' },
            age_correct: { type: 'string', enum: ['correct', 'acceptable', 'wrong', 'missing_ok', 'missing_bad'], description: 'Age limit extraction quality' },
            title_quality: { type: 'string', enum: ['excellent', 'good', 'acceptable', 'poor'], description: 'How useful/clean is the extracted title? Excellent = artist name. Poor = metadata or garbage.' },
            overall_grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'], description: 'Overall extraction quality' },
            reasoning: { type: 'string', description: 'Brief explanation of the grade' },
        },
    },
};

const JUDGE_SYSTEM = `You are an eval judge for a concert listing parser. You evaluate how well a regex-based parser extracted structured show data from an Instagram post.

Grade criteria:
- DATE: Must be correct ISO date. Wrong date = automatic D or lower.
- TIME: "correct" if exact match, "acceptable" if close (e.g. doors vs show time), "missing_ok" if time genuinely wasn't in the post, "missing_bad" if time was there but missed.
- PRICE: Same scale. "$10" extracted as "$10" is correct. "$10 adv / $12 door" vs "$10/$12" is acceptable.
- AGE: "AA" means "All Ages", "21+" means "21+". Missing when it was clearly stated = missing_bad.
- TITLE: "excellent" = clean artist name. "good" = artist name with minor noise. "acceptable" = usable but messy. "poor" = contains metadata, dates, or venue name instead of artist.
- OVERALL: A = all fields correct/excellent. B = minor issues. C = usable but messy. D = significant errors. F = fundamentally wrong.

Be a fair but strict grader. Real users will see these results.`;

// ── Run judge eval ───────────────────────────────────────────────────────────

console.log('\n🧑‍⚖️ LLM-as-Judge Parser Eval\n');

let grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
let total = 0;

for (const tc of JUDGE_CASES) {
    const parsed = regexParse(tc.input);
    total++;

    const userMessage = `## Original Post
\`\`\`
${tc.input}
\`\`\`

## Parser Output
\`\`\`json
${JSON.stringify(parsed, null, 2)}
\`\`\`

Grade this extraction.`;

    try {
        const response = await askWithTools(JUDGE_SYSTEM, userMessage, [JUDGE_TOOL], {
            toolChoice: { type: 'tool', name: 'grade_parse' },
            maxTokens: 1024,
        });

        const toolUse = response.content.find(b => b.type === 'tool_use');
        if (!toolUse) {
            console.log(`  ⚠️  ${tc.id}: Judge did not return a grade`);
            continue;
        }

        const grade = toolUse.input;
        grades[grade.overall_grade]++;

        const icon = { A: '🟢', B: '🟢', C: '🟡', D: '🔴', F: '🔴' }[grade.overall_grade];
        console.log(`  ${icon} ${tc.id}: ${grade.overall_grade} — title: ${grade.title_quality}, date: ${grade.date_correct ? '✓' : '✗'}`);

        if (verbose) {
            console.log(`     date=${grade.date_correct} time=${grade.time_correct} price=${grade.price_correct} age=${grade.age_correct}`);
            console.log(`     ${grade.reasoning}\n`);
        }
    } catch (err) {
        console.log(`  ❌ ${tc.id}: Judge error — ${err.message}`);
    }
}

// Summary
console.log(`\n📊 Judge eval: ${total} cases`);
console.log(`   🟢 A: ${grades.A}  B: ${grades.B}`);
console.log(`   🟡 C: ${grades.C}`);
console.log(`   🔴 D: ${grades.D}  F: ${grades.F}`);

const score = (grades.A * 4 + grades.B * 3 + grades.C * 2 + grades.D * 1) / (total * 4);
console.log(`   GPA: ${(score * 4).toFixed(2)} / 4.00\n`);

// Fail if average is below C
process.exit(score < 0.5 ? 1 : 0);
