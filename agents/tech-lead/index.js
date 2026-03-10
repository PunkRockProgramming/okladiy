#!/usr/bin/env node
/**
 * Tech Lead Agent
 *
 * Takes a problem statement, researches it, and writes a decision proposal
 * to DECISIONS.md. Uses Claude to analyze the problem and formulate the proposal.
 *
 * Usage:
 *   node agents/tech-lead/index.js "problem statement here"
 *   node agents/tech-lead/index.js check DEC-0001    # check if a decision is approved
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { askWithTools } from '../lib/claude.js';
import { parseDecisions, appendDecision, isApproved, getDecisionsByStatus } from '../lib/decisions.js';
import { getOpenAnomalies } from '../lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');

const SYSTEM_PROMPT = `You are the Tech Lead agent for OKDIY, a local show aggregator that scrapes OKC and Tulsa venue websites for concert listings.

Your job is to investigate technical problems and write decision proposals. You are thorough, opinionated, and specific. You name exact libraries, APIs, and approaches — never hand-wave.

You know the current system:
- Node.js ESM scraper with per-venue modules
- Cheerio for HTML parsing, Playwright for JS-rendered pages
- Shows normalized to a standard schema (title, venue, date, time, price, etc.)
- Output is a static shows.json consumed by a frontend

When analyzing a problem:
1. Identify the core technical question
2. Research viable approaches (you can reason about what you know about APIs, libraries, and web scraping)
3. Evaluate tradeoffs honestly — don't recommend something just because it's trendy
4. Be specific about what would change in the codebase

Your output MUST use the write_proposal tool to structure your recommendation.`;

const PROPOSAL_TOOL = {
    name: 'write_proposal',
    description: 'Write a structured decision proposal for DECISIONS.md',
    input_schema: {
        type: 'object',
        required: ['title', 'context', 'proposal', 'alternatives', 'impact'],
        properties: {
            title: {
                type: 'string',
                description: 'Short descriptive title for the decision (e.g. "Use RSSHub for Instagram data access")',
            },
            context: {
                type: 'string',
                description: 'Why this decision is needed. What problem does it solve? 2-4 paragraphs.',
            },
            proposal: {
                type: 'string',
                description: 'What you recommend. Be specific — name the library, the approach, the tradeoffs. Include code snippets if helpful.',
            },
            alternatives: {
                type: 'string',
                description: 'What else was evaluated and why it was rejected. Be fair to the alternatives.',
            },
            impact: {
                type: 'string',
                description: 'What changes once this is approved. Which agents/files/systems are affected.',
            },
        },
    },
};

// ── Commands ──────────────────────────────────────────────────────────────────

async function investigate(problem) {
    console.log(`\n🔍 Tech Lead investigating: "${problem}"\n`);

    // Gather context
    const existingDecisions = parseDecisions();
    const claudeMd = readFileSync(join(PROJECT_ROOT, 'CLAUDE.md'), 'utf-8');

    let contextBlock = `## Existing Codebase Context\n\n${claudeMd}\n\n`;

    if (existingDecisions.length > 0) {
        contextBlock += `## Prior Decisions\n\n`;
        for (const dec of existingDecisions) {
            contextBlock += `- ${dec.id}: ${dec.title} [${dec.status}]\n`;
        }
        contextBlock += '\n';
    }

    const userMessage = `${contextBlock}## Problem to Investigate

${problem}

Analyze this problem thoroughly. Consider the existing codebase, what approaches are available, and what tradeoffs exist. Then use the write_proposal tool to submit your recommendation.`;

    const response = await askWithTools(SYSTEM_PROMPT, userMessage, [PROPOSAL_TOOL], {
        toolChoice: { type: 'tool', name: 'write_proposal' },
        maxTokens: 4096,
    });

    // Extract the tool use
    const toolUse = response.content.find(block => block.type === 'tool_use');
    if (!toolUse) {
        console.error('❌ Tech Lead did not produce a proposal. Raw response:');
        console.error(JSON.stringify(response.content, null, 2));
        process.exit(1);
    }

    const { title, context, proposal, alternatives, impact } = toolUse.input;

    // Write to DECISIONS.md
    const result = appendDecision({
        title,
        proposedBy: 'tech-lead',
        context,
        proposal,
        alternatives,
        impact,
    });

    console.log(`✅ Proposal written: ${result.id}: ${result.title}`);
    console.log(`\n📋 Review it in DECISIONS.md and set status to \`approved\` or \`rejected\`.\n`);
}

function checkDecision(decId) {
    if (isApproved(decId)) {
        console.log(`✅ ${decId} is approved — safe to proceed.`);
    } else {
        const decisions = parseDecisions();
        const dec = decisions.find(d => d.id === decId);
        if (!dec) {
            console.log(`❌ ${decId} not found in DECISIONS.md`);
        } else {
            console.log(`⏳ ${decId} is "${dec.status}" — cannot proceed until approved.`);
        }
    }
}

function listPending() {
    const pending = getDecisionsByStatus('proposed');
    if (pending.length === 0) {
        console.log('No pending proposals.');
        return;
    }
    console.log(`\n📋 Pending proposals:\n`);
    for (const dec of pending) {
        console.log(`  ${dec.id}: ${dec.title} (proposed ${dec.dateProposed})`);
    }
    console.log();
}

// ── Auto-Investigate ─────────────────────────────────────────────────────────

const MAX_AUTO_INVESTIGATIONS = 2;

async function autoInvestigate() {
    const anomalies = getOpenAnomalies();

    if (anomalies.length === 0) {
        console.log('\n✅ No open anomalies to investigate.\n');
        return;
    }

    // Filter out anomalies that already have a pending/approved decision
    const decisions = parseDecisions();
    const decisionProblems = decisions.map(d => d.body?.toLowerCase() || '');

    const uninvestigated = anomalies.filter(a => {
        const key = (a.message || '').toLowerCase();
        // Skip if there's already a decision mentioning this anomaly
        return !decisionProblems.some(body => body.includes(key.slice(0, 40)));
    });

    if (uninvestigated.length === 0) {
        console.log(`\n📋 All ${anomalies.length} open anomalies already have decision proposals.\n`);
        return;
    }

    const toInvestigate = uninvestigated.slice(0, MAX_AUTO_INVESTIGATIONS);

    console.log(`\n🔍 Auto-investigating ${toInvestigate.length} of ${uninvestigated.length} open anomalies...\n`);

    for (const anomaly of toInvestigate) {
        const problem = `[Auto-investigation] Anomaly detected at ${anomaly.detected_at}:
Type: ${anomaly.type}
Severity: ${anomaly.severity}
Venue: ${anomaly.venue || 'N/A'}
Message: ${anomaly.message}

Investigate this anomaly, determine the root cause, and propose a fix.`;

        try {
            await investigate(problem);
        } catch (err) {
            console.error(`❌ Failed to investigate anomaly: ${err.message}`);
        }
    }

    console.log(`\n✅ Auto-investigation complete. ${toInvestigate.length} anomalies processed.\n`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0) {
    console.log(`Usage:
  node agents/tech-lead/index.js "problem statement"     Investigate and propose
  node agents/tech-lead/index.js check DEC-0001          Check if a decision is approved
  node agents/tech-lead/index.js pending                  List pending proposals
  node agents/tech-lead/index.js auto-investigate         Auto-investigate open anomalies`);
    process.exit(0);
}

if (args[0] === 'check') {
    checkDecision(args[1]);
} else if (args[0] === 'pending') {
    listPending();
} else if (args[0] === 'auto-investigate') {
    autoInvestigate().catch(err => {
        console.error('❌ Error:', err.message);
        process.exit(1);
    });
} else {
    const problem = args.join(' ');
    investigate(problem).catch(err => {
        console.error('❌ Error:', err.message);
        process.exit(1);
    });
}
