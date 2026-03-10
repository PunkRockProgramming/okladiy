#!/usr/bin/env node
/**
 * PM Agent — Project Manager / Orchestrator
 *
 * Reads system state, identifies what needs doing, delegates to other agents.
 * Does NOT make technical decisions — routes them to Tech Lead.
 *
 * Usage:
 *   node agents/pm/index.js status         Show system state summary
 *   node agents/pm/index.js assess         Analyze state and recommend next actions
 *   node agents/pm/index.js delegate       Assess + execute delegations automatically
 *   node agents/pm/index.js plan-sprint    Draft a SPRINT.md from current state + roadmap
 *   node agents/pm/index.js review         Summarize what changed since last run
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { parseDecisions, getDecisionsByStatus } from '../lib/decisions.js';
import { getDb, getLatestRuns, getOpenAnomalies, getPendingTasks, createTask, updateTask } from '../lib/db.js';
import { ask } from '../lib/claude.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const TECH_LEAD = join(__dirname, '../tech-lead/index.js');

// ── State Gathering ──────────────────────────────────────────────────────────

function gatherState() {
    const state = {};

    // Decisions
    const decisions = parseDecisions();
    state.decisions = {
        total: decisions.length,
        proposed: decisions.filter(d => d.status === 'proposed'),
        approved: decisions.filter(d => d.status === 'approved'),
        rejected: decisions.filter(d => d.status === 'rejected'),
    };

    // Scraper health
    state.scraperRuns = getLatestRuns();

    // Anomalies
    state.anomalies = getOpenAnomalies();

    // Pending agent tasks
    state.pendingTasks = getPendingTasks();

    // Sprint
    const sprintPath = join(PROJECT_ROOT, 'SPRINT.md');
    state.sprint = existsSync(sprintPath) ? readFileSync(sprintPath, 'utf-8') : null;

    // Existing scrapers
    const scrapersDir = join(PROJECT_ROOT, 'scraper/scrapers');
    if (existsSync(scrapersDir)) {
        const files = readFileSync('/dev/null', 'utf-8'); // placeholder
        try {
            state.scrapers = execSync(`ls ${scrapersDir}/*.js`, { encoding: 'utf-8' })
                .trim().split('\n')
                .map(f => f.split('/').pop().replace('.js', ''))
                .filter(f => !f.startsWith('_'));
        } catch {
            state.scrapers = [];
        }
    }

    return state;
}

// ── Display ──────────────────────────────────────────────────────────────────

function printStatus(state) {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║         OKDIY PM — System Status     ║');
    console.log('╚══════════════════════════════════════╝\n');

    // Decisions
    console.log('📋 Decisions');
    if (state.decisions.total === 0) {
        console.log('   No decisions yet.\n');
    } else {
        if (state.decisions.proposed.length > 0) {
            console.log(`   ⏳ Pending review (${state.decisions.proposed.length}):`);
            for (const d of state.decisions.proposed) {
                console.log(`      ${d.id}: ${d.title}`);
            }
        }
        if (state.decisions.approved.length > 0) {
            console.log(`   ✅ Approved (${state.decisions.approved.length}):`);
            for (const d of state.decisions.approved) {
                console.log(`      ${d.id}: ${d.title}`);
            }
        }
        if (state.decisions.rejected.length > 0) {
            console.log(`   ❌ Rejected (${state.decisions.rejected.length}):`);
            for (const d of state.decisions.rejected) {
                console.log(`      ${d.id}: ${d.title}`);
            }
        }
        console.log();
    }

    // Scraper health
    console.log('🔧 Scraper Health');
    if (state.scraperRuns.length === 0) {
        console.log('   No scraper runs recorded yet.');
        if (state.scrapers?.length > 0) {
            console.log(`   Known scrapers: ${state.scrapers.join(', ')}`);
        }
    } else {
        for (const run of state.scraperRuns) {
            const icon = run.status === 'success' ? '✅' : '❌';
            const shows = run.show_count !== null ? ` (${run.show_count} shows)` : '';
            const time = run.duration_ms ? ` ${run.duration_ms}ms` : '';
            console.log(`   ${icon} ${run.venue}${shows}${time} — ${run.started_at}`);
            if (run.error_message) console.log(`      Error: ${run.error_message}`);
        }
    }
    console.log();

    // Anomalies
    console.log('⚠️  Open Anomalies');
    if (state.anomalies.length === 0) {
        console.log('   None.\n');
    } else {
        for (const a of state.anomalies) {
            console.log(`   [${a.severity}] ${a.type} — ${a.message}`);
        }
        console.log();
    }

    // Pending tasks
    console.log('📝 Agent Tasks');
    if (state.pendingTasks.length === 0) {
        console.log('   No pending tasks.\n');
    } else {
        for (const t of state.pendingTasks) {
            console.log(`   [${t.status}] → ${t.assigned_to}: ${t.task}`);
        }
        console.log();
    }

    // Sprint
    if (state.sprint) {
        const goalMatch = state.sprint.match(/## Goal\n\n(.+?)(?:\n\n---|\n\n##)/s);
        if (goalMatch) {
            console.log('🎯 Sprint Goal');
            console.log(`   ${goalMatch[1].trim()}\n`);
        }

        // Count open/closed tasks
        const open = (state.sprint.match(/- \[ \]/g) || []).length;
        const closed = (state.sprint.match(/- \[x\]/gi) || []).length;
        if (open + closed > 0) {
            console.log(`   Tasks: ${closed}/${open + closed} complete\n`);
        }
    }
}

// ── Assessment ───────────────────────────────────────────────────────────────

const PM_SYSTEM = `You are the PM agent for OKDIY, a local show aggregator for OKC and Tulsa venues.

Your job is to analyze the current system state and decide what needs to happen next. You are practical, decisive, and focused on unblocking work.

You do NOT make technical decisions — you delegate those to the Tech Lead agent.
You do NOT write code — you delegate to worker agents.

Your outputs are structured action items. For each action, specify:
- WHO should do it (tech-lead, scraper, parser, validator, or human)
- WHAT they should do (specific problem statement or task)
- WHY it matters (what it unblocks)
- PRIORITY (1 = do now, 2 = do next, 3 = backlog)

Be concise. Don't repeat the state back — just analyze and recommend.`;

async function assess(state) {
    const stateSnapshot = JSON.stringify({
        decisions: {
            proposed: state.decisions.proposed.map(d => ({ id: d.id, title: d.title })),
            approved: state.decisions.approved.map(d => ({ id: d.id, title: d.title })),
            rejected: state.decisions.rejected.map(d => ({ id: d.id, title: d.title })),
        },
        scraperRuns: state.scraperRuns,
        anomalies: state.anomalies,
        pendingTasks: state.pendingTasks,
        scrapers: state.scrapers,
        sprintGoal: state.sprint?.match(/## Goal\n\n(.+?)(?:\n\n---|\n\n##)/s)?.[1]?.trim(),
        sprintOpenTasks: (state.sprint?.match(/- \[ \] \*\*(.+?)\*\*/g) || []).map(t => t.replace(/- \[ \] \*\*|\*\*/g, '')),
    }, null, 2);

    console.log('\n🤔 PM analyzing system state...\n');

    const assessment = await ask(PM_SYSTEM, `Here is the current OKDIY system state:\n\n${stateSnapshot}\n\nWhat should happen next? Give me prioritized action items.`);

    console.log(assessment);
    return assessment;
}

// ── Delegation ───────────────────────────────────────────────────────────────

const DELEGATION_SYSTEM = `You are the PM agent for OKDIY. Based on the current system state and your assessment, decide which delegations to execute RIGHT NOW.

Output a JSON array of delegation objects. Each object:
{
  "agent": "tech-lead" | "scraper" | "parser" | "validator",
  "action": "investigate" | "run" | "validate",
  "input": "the problem statement or command to pass to the agent",
  "reason": "why this delegation"
}

Rules:
- Only delegate to tech-lead for investigation/proposals. The input should be a clear problem statement.
- Only delegate work that is covered by an approved decision OR that is purely investigative (tech-lead proposals).
- If there are proposed decisions awaiting review, do NOT delegate implementation work for them — flag that a human needs to review first.
- If there is nothing actionable, return an empty array [].
- Maximum 2 delegations per invocation to keep things focused.

Return ONLY the JSON array, no other text.`;

async function delegate(state) {
    // First show status and assessment
    printStatus(state);
    const assessment = await assess(state);

    const stateSnapshot = JSON.stringify({
        decisions: {
            proposed: state.decisions.proposed.map(d => ({ id: d.id, title: d.title })),
            approved: state.decisions.approved.map(d => ({ id: d.id, title: d.title })),
        },
        scraperRuns: state.scraperRuns,
        anomalies: state.anomalies,
        pendingTasks: state.pendingTasks,
        scrapers: state.scrapers,
    }, null, 2);

    console.log('\n📤 PM determining delegations...\n');

    const response = await ask(DELEGATION_SYSTEM, `State:\n${stateSnapshot}\n\nAssessment:\n${assessment}\n\nWhat delegations should I execute now?`);

    let delegations;
    try {
        // Extract JSON from response (may be wrapped in markdown code fence)
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        delegations = JSON.parse(jsonMatch[0]);
    } catch {
        console.log('No actionable delegations identified.');
        console.log('Raw response:', response);
        return;
    }

    if (delegations.length === 0) {
        console.log('✅ No delegations needed right now.');
        return;
    }

    for (const del of delegations) {
        console.log(`\n🔀 Delegating to ${del.agent}: ${del.input}`);
        console.log(`   Reason: ${del.reason}`);

        // Log the task
        const taskId = createTask(del.agent, 'pm', del.input);

        if (del.agent === 'tech-lead') {
            try {
                console.log(`\n--- Tech Lead running ---\n`);
                updateTask(taskId, 'running');
                const cmd = del.action === 'auto-investigate'
                    ? `node "${TECH_LEAD}" auto-investigate`
                    : `node "${TECH_LEAD}" ${JSON.stringify(del.input)}`;
                const output = execSync(cmd, {
                    encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 120000,
                });
                console.log(output);
                updateTask(taskId, 'done', output);
            } catch (err) {
                console.error(`❌ Tech Lead failed: ${err.message}`);
                updateTask(taskId, 'failed', err.message);
            }
        } else {
            // Other agents not yet built — log as pending
            console.log(`   ⏳ Agent "${del.agent}" not yet implemented — task logged as pending.`);
        }
    }

    console.log('\n✅ Delegation round complete.\n');
}

// ── Plan Sprint ─────────────────────────────────────────────────────────────

function gatherExtendedState(state) {
    const ext = { ...state };

    // Shows.json stats
    const showsPath = join(PROJECT_ROOT, 'docs/shows.json');
    if (existsSync(showsPath)) {
        try {
            const shows = JSON.parse(readFileSync(showsPath, 'utf-8'));
            const arr = Array.isArray(shows) ? shows : [];
            const venues = {};
            for (const s of arr) venues[s.venue] = (venues[s.venue] || 0) + 1;
            const now = new Date();
            const future = arr.filter(s => new Date(s.date) >= now).length;
            ext.showsStats = {
                total: arr.length,
                futureShows: future,
                pastShows: arr.length - future,
                venueBreakdown: venues,
            };
        } catch { ext.showsStats = null; }
    }

    // Roadmap
    const roadmapPaths = [
        join(PROJECT_ROOT, 'ROADMAP.md'),
        join(PROJECT_ROOT, '../project-roadmap.md'),
    ];
    for (const p of roadmapPaths) {
        if (existsSync(p)) {
            ext.roadmap = readFileSync(p, 'utf-8');
            break;
        }
    }

    // Recent completed tasks
    try {
        const db = getDb();
        ext.recentTasks = db.prepare(`
            SELECT * FROM agent_tasks WHERE status IN ('done', 'failed')
            ORDER BY completed_at DESC LIMIT 10
        `).all();
        db.close();
    } catch { ext.recentTasks = []; }

    return ext;
}

const PLAN_SPRINT_SYSTEM = `You are the PM agent for OKDIY, a local show aggregator for OKC and Tulsa venues.

Your job is to draft a sprint plan (SPRINT.md) based on the current system state, open issues, and project roadmap.

Output a complete SPRINT.md file in markdown format following this template:

# Sprint: [Short Name]

**Date:** [today's date]
**Type:** [Build|Content|Debt]
**Ratio:** [e.g. 70% feature / 30% maintenance]

---

## Goal

[1-2 sentences describing what this sprint accomplishes]

---

## Decisions (locked before sprint starts)

[Any decisions that need human approval before work begins]

---

## Tasks

[Prioritized task checklist grouped by category. Each task should be actionable and specific.]

---

## Done When

[Measurable success criteria]

Rules:
- Focus on the most impactful work that's currently unblocked
- Don't plan work that requires unapproved decisions — flag those as blockers
- If scrapers are failing, maintenance tasks come first
- Group tasks logically (e.g. "Agent Improvements", "Scraper Maintenance", "Venue Expansion")
- Be specific: name files, commands, and expected outcomes
- Keep it achievable — aim for 3-5 days of work, not a month`;

async function planSprint(state) {
    const ext = gatherExtendedState(state);

    const stateSnapshot = JSON.stringify({
        decisions: {
            proposed: ext.decisions.proposed.map(d => ({ id: d.id, title: d.title })),
            approved: ext.decisions.approved.map(d => ({ id: d.id, title: d.title })),
        },
        scraperRuns: ext.scraperRuns,
        anomalies: ext.anomalies,
        pendingTasks: ext.pendingTasks,
        recentTasks: ext.recentTasks || [],
        scrapers: ext.scrapers,
        showsStats: ext.showsStats,
        currentSprint: ext.sprint ? {
            goal: ext.sprint.match(/## Goal\n\n(.+?)(?:\n\n---|\n\n##)/s)?.[1]?.trim(),
            openTasks: (ext.sprint.match(/- \[ \] .+/g) || []).map(t => t.replace('- [ ] ', '')),
            doneTasks: (ext.sprint.match(/- \[x\] .+/gi) || []).map(t => t.replace(/- \[x\] /i, '')),
        } : null,
    }, null, 2);

    const roadmapSection = ext.roadmap
        ? `\n\n## Project Roadmap\n\n${ext.roadmap.slice(0, 3000)}`
        : '\n\n(No roadmap file found.)';

    console.log('\n📋 PM drafting sprint plan...\n');

    const draft = await ask(PLAN_SPRINT_SYSTEM,
        `Today's date: ${new Date().toISOString().split('T')[0]}\n\nSystem state:\n${stateSnapshot}${roadmapSection}\n\nDraft me a sprint plan.`,
        { maxTokens: 4096 }
    );

    // Write draft to SPRINT-DRAFT.md
    const draftPath = join(PROJECT_ROOT, 'SPRINT-DRAFT.md');
    writeFileSync(draftPath, draft, 'utf-8');

    console.log(draft);
    console.log(`\n📄 Draft saved to SPRINT-DRAFT.md`);
    console.log(`   Review and rename to SPRINT.md when ready.\n`);
}

// ── Review ──────────────────────────────────────────────────────────────────

const REVIEW_SYSTEM = `You are the PM agent for OKDIY. Give a concise status review of what has changed in the system.

Format your output as:

## Status Review — [date]

### Scraper Health
[Summary of scraper status — any failures, show counts, trends]

### Open Issues
[Anomalies, failing scrapers, pending decisions that need human attention]

### Recently Completed
[Tasks done, decisions resolved]

### Recommendations
[1-3 bullet points of what should happen next]

Be direct and brief. Flag anything that needs human attention immediately.`;

async function review(state) {
    const ext = gatherExtendedState(state);

    const stateSnapshot = JSON.stringify({
        scraperRuns: ext.scraperRuns,
        anomalies: ext.anomalies,
        pendingTasks: ext.pendingTasks,
        recentTasks: ext.recentTasks || [],
        decisions: {
            proposed: ext.decisions.proposed.map(d => ({ id: d.id, title: d.title })),
            approved: ext.decisions.approved.map(d => ({ id: d.id, title: d.title, dateResolved: d.dateResolved })),
            rejected: ext.decisions.rejected.map(d => ({ id: d.id, title: d.title, dateResolved: d.dateResolved })),
        },
        showsStats: ext.showsStats,
        currentSprint: ext.sprint ? {
            openTasks: (ext.sprint.match(/- \[ \] .+/g) || []).length,
            doneTasks: (ext.sprint.match(/- \[x\] .+/gi) || []).length,
        } : null,
    }, null, 2);

    console.log('\n📊 PM reviewing system state...\n');

    const summary = await ask(REVIEW_SYSTEM,
        `Today's date: ${new Date().toISOString().split('T')[0]}\n\nCurrent system state:\n${stateSnapshot}`,
        { maxTokens: 2048 }
    );

    console.log(summary);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const command = process.argv[2] || 'status';
const state = gatherState();

switch (command) {
    case 'status':
        printStatus(state);
        break;
    case 'assess':
        printStatus(state);
        await assess(state);
        break;
    case 'delegate':
        await delegate(state);
        break;
    case 'plan-sprint':
        await planSprint(state);
        break;
    case 'review':
        await review(state);
        break;
    default:
        console.log(`Unknown command: ${command}`);
        console.log('Usage: node agents/pm/index.js [status|assess|delegate|plan-sprint|review]');
        process.exit(1);
}
