/**
 * Shared utilities for reading and writing DECISIONS.md
 */
import { readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DECISIONS_PATH = join(__dirname, '../../DECISIONS.md');

/**
 * Parse all decisions from DECISIONS.md
 * Returns array of { number, title, status, proposedBy, dateProposed, dateResolved, body }
 */
export function parseDecisions() {
    const content = readFileSync(DECISIONS_PATH, 'utf-8');
    const decisions = [];

    // Split on H2 decision headers (## DEC-XXXX: Title)
    const regex = /^## (DEC-(\d{4})): (.+)$/gm;
    let match;
    const headers = [];

    while ((match = regex.exec(content)) !== null) {
        headers.push({
            fullMatch: match[1],
            number: parseInt(match[2], 10),
            title: match[3].trim(),
            index: match.index,
        });
    }

    for (let i = 0; i < headers.length; i++) {
        const start = headers[i].index;
        const end = i + 1 < headers.length ? headers[i + 1].index : content.length;
        const section = content.slice(start, end);

        const statusMatch = section.match(/\*\*Status:\*\*\s*`(\w+)`/);
        const proposedByMatch = section.match(/\*\*Proposed by:\*\*\s*(.+)/);
        const dateProposedMatch = section.match(/\*\*Date proposed:\*\*\s*(\S+)/);
        const dateResolvedMatch = section.match(/\*\*Date resolved:\*\*\s*(\S+)/);

        decisions.push({
            id: headers[i].fullMatch,
            number: headers[i].number,
            title: headers[i].title,
            status: statusMatch ? statusMatch[1] : 'unknown',
            proposedBy: proposedByMatch ? proposedByMatch[1].trim() : 'unknown',
            dateProposed: dateProposedMatch ? dateProposedMatch[1] : null,
            dateResolved: dateResolvedMatch ? dateResolvedMatch[1] : null,
            body: section,
        });
    }

    return decisions;
}

/**
 * Get the next sequential DEC number
 */
export function getNextDecNumber() {
    const decisions = parseDecisions();
    if (decisions.length === 0) return 1;
    return Math.max(...decisions.map(d => d.number)) + 1;
}

/**
 * Check if a specific decision is approved
 */
export function isApproved(decId) {
    const decisions = parseDecisions();
    const dec = decisions.find(d => d.id === decId);
    return dec?.status === 'approved';
}

/**
 * Get all decisions with a given status
 */
export function getDecisionsByStatus(status) {
    return parseDecisions().filter(d => d.status === status);
}

/**
 * Append a new decision proposal to DECISIONS.md
 */
export function appendDecision({ title, proposedBy, context, proposal, alternatives = 'None noted.', impact = 'To be determined on approval.' }) {
    const num = getNextDecNumber();
    const id = `DEC-${String(num).padStart(4, '0')}`;
    const today = new Date().toISOString().split('T')[0];

    const entry = `

## ${id}: ${title}

**Status:** \`proposed\`
**Proposed by:** ${proposedBy}
**Date proposed:** ${today}
**Date resolved:**

### Context
${context}

### Proposal
${proposal}

### Alternatives Considered
${alternatives}

### Decision
*(Awaiting human review)*

### Impact
${impact}
`;

    appendFileSync(DECISIONS_PATH, entry, 'utf-8');
    return { id, title };
}

/**
 * Get the path to DECISIONS.md (for agents that need to read it raw)
 */
export function getDecisionsPath() {
    return DECISIONS_PATH;
}
