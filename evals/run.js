#!/usr/bin/env node
/**
 * OKDIY Eval Harness
 *
 * Runs all evals and produces a summary report.
 *
 * Usage:
 *   node evals/run.js              Run all evals
 *   node evals/run.js --fast       Skip LLM judge (deterministic only)
 *   node evals/run.js --verbose    Show full judge reasoning
 */
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const fast = process.argv.includes('--fast');
const verbose = process.argv.includes('--verbose');

const EVALS = [
    { name: 'Schema Compliance', file: 'schema.eval.js', type: 'deterministic' },
    { name: 'Parser Accuracy', file: 'parser.eval.js', type: 'deterministic' },
    { name: 'LLM Judge (Parser Quality)', file: 'judge.eval.js', type: 'llm', args: verbose ? ['--verbose'] : [] },
];

console.log('\n╔══════════════════════════════════════╗');
console.log('║        OKDIY Eval Harness            ║');
console.log('╚══════════════════════════════════════╝\n');

const results = [];

for (const eval_ of EVALS) {
    if (fast && eval_.type === 'llm') {
        console.log(`⏭️  Skipping ${eval_.name} (--fast mode)\n`);
        results.push({ name: eval_.name, status: 'skipped' });
        continue;
    }

    console.log(`━━━ ${eval_.name} ━━━\n`);

    try {
        const args = eval_.args ? eval_.args.join(' ') : '';
        const output = execSync(
            `node ${join(__dirname, eval_.file)} ${args}`,
            { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 120000 }
        );
        console.log(output);
        results.push({ name: eval_.name, status: 'passed' });
    } catch (err) {
        // execSync throws on non-zero exit
        console.log(err.stdout || '');
        console.log(err.stderr || '');
        results.push({ name: eval_.name, status: 'failed' });
    }
}

// Summary
console.log('━━━ Summary ━━━\n');

for (const r of results) {
    const icon = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
    console.log(`  ${icon} ${r.name}: ${r.status}`);
}

const failCount = results.filter(r => r.status === 'failed').length;
console.log(`\n${failCount === 0 ? '✅ All evals passed' : `❌ ${failCount} eval(s) failed`}\n`);

process.exit(failCount > 0 ? 1 : 0);
