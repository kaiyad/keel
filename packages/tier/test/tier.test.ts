import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGraph, resolveSpec } from '../dist/deps.js';
import { readLcov } from '../dist/coverage.js';
import { changeTier, scoreFile, signalsFor } from '../dist/score.js';
import { DEFAULT_CONFIG } from '../dist/types.js';

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tier-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const config = DEFAULT_CONFIG;
const noHistory = () => [];

test('reverse dependencies are counted from resolvable intra-repo imports only', () => {
  const root = repo({
    'src/payments/charge.ts': `import { post } from './ledger';\nimport fetch from 'node-fetch';\n`,
    'src/payments/refund.ts': `import { post } from './ledger';\n`,
    'src/payments/ledger.ts': 'export const post = 1;\n',
    'src/web/page.ts': `const { post } = require('../payments/ledger');\n`,
  });
  const graph = buildGraph(root);
  assert.equal(graph.dependents.get('src/payments/ledger.ts')?.size, 3);
  assert.equal(graph.dependents.get('src/payments/charge.ts'), undefined);
  assert.equal(graph.unresolved, 1, 'node-fetch is not in the repo and is reported, not guessed');
});

test('python packages resolve through __init__ and dotted paths', () => {
  const root = repo({
    'src/autopilot/__init__.py': '',
    'src/autopilot/engine.py': 'VALUE = 1\n',
    'app.py': 'from src.autopilot.engine import VALUE\n',
  });
  const graph = buildGraph(root);
  assert.equal(graph.dependents.get('src/autopilot/engine.py')?.size, 1);
  assert.equal(resolveSpec('./engine', 'src/autopilot/__init__.py', new Set(['src/autopilot/engine.py'])), 'src/autopilot/engine.py');
});

test('lcov line coverage is read per file', () => {
  const root = repo({
    'coverage/lcov.info': ['SF:src/a.ts', 'LF:10', 'LH:8', 'end_of_record', 'SF:src/b.ts', 'LF:4', 'LH:1', 'end_of_record'].join('\n'),
  });
  const cov = readLcov(root, 'coverage/lcov.info');
  assert.equal(cov?.get('src/a.ts'), 0.8);
  assert.equal(cov?.get('src/b.ts'), 0.25);
  assert.equal(readLcov(root, 'nope.info'), null);
});

test('a well-covered leaf file is tier 0 and auto-mergeable', () => {
  const root = repo({ 'src/web/widget.ts': 'export const x = 1;\n' });
  const graph = buildGraph(root);
  const coverage = new Map([['src/web/widget.ts', 1]]);
  const scored = scoreFile(
    signalsFor('src/web/widget.ts', { root, config, graph, coverage, log: noHistory }),
    config,
  );
  assert.equal(scored.tier, 0);
  assert.equal(config.policies['0']?.autoMerge, true);
});

test('the load-bearing core is never below tier 2, whatever the arithmetic says', () => {
  const root = repo({ 'src/payments/charge.ts': 'export const x = 1;\n' });
  const graph = buildGraph(root);
  const scored = scoreFile(
    signalsFor('src/payments/charge.ts', {
      root,
      config,
      graph,
      coverage: new Map([['src/payments/charge.ts', 1]]),
      log: noHistory,
    }),
    config,
  );
  assert.ok(scored.tier >= 2, `expected at least tier 2, got ${scored.tier}`);
  assert.match(scored.reasons[0] ?? '', /floor/);
});

test('load-bearing and irreversible is tier 3, with dual key and human authoring', () => {
  const root = repo({ 'db/migrations/0004_shelf.sql': 'alter table x;\n' });
  const graph = buildGraph(root);
  const scored = scoreFile(
    signalsFor('db/migrations/0004_shelf.sql', { root, config, graph, coverage: null, log: noHistory }),
    config,
  );
  assert.equal(scored.tier, 3);
  assert.equal(scored.signals.reversible, false);
  assert.equal(scored.signals.sensitive, true);
  assert.equal(config.policies['3']?.dualKey, true);
  assert.equal(config.policies['3']?.humanAuthoring, true);
});

test('incident history raises the tier of otherwise ordinary code', () => {
  const root = repo({ 'src/web/checkout.ts': 'export const x = 1;\n' });
  const graph = buildGraph(root);
  const quiet = scoreFile(
    signalsFor('src/web/checkout.ts', {
      root,
      config,
      graph,
      coverage: new Map([['src/web/checkout.ts', 0.9]]),
      log: () => [{ subject: 'add a field' }, { subject: 'rename a thing' }, { subject: 'tidy' }],
    }),
    config,
  );
  const scarred = scoreFile(
    signalsFor('src/web/checkout.ts', {
      root,
      config,
      graph,
      coverage: new Map([['src/web/checkout.ts', 0.9]]),
      log: () => [
        { subject: 'fix double submit' },
        { subject: 'revert "fix double submit"' },
        { subject: 'hotfix INC-2025-03 checkout 500s' },
      ],
    }),
    config,
  );
  assert.ok(scarred.risk > quiet.risk, `${scarred.risk} should exceed ${quiet.risk}`);
  assert.ok(scarred.tier > quiet.tier);
});

test('a change is scored at the tier of its most dangerous file', () => {
  const root = repo({
    'src/web/widget.ts': 'export const x = 1;\n',
    'db/migrations/0001_init.sql': 'create table x;\n',
  });
  const graph = buildGraph(root);
  const scored = ['src/web/widget.ts', 'db/migrations/0001_init.sql'].map((p) =>
    scoreFile(signalsFor(p, { root, config, graph, coverage: null, log: noHistory }), config),
  );
  assert.equal(changeTier(scored), 3);
});

test('missing coverage is stated as a note rather than assumed to be fine', () => {
  const root = repo({ 'src/web/widget.ts': 'export const x = 1;\n' });
  const signals = signalsFor('src/web/widget.ts', {
    root,
    config,
    graph: buildGraph(root),
    coverage: null,
    log: noHistory,
  });
  assert.equal(signals.coverage, null);
  assert.ok(signals.notes.some((n) => /no coverage report/.test(n)));
});

test('exempt paths skip scoring instead of being nagged about missing coverage', () => {
  const root = repo({ 'README.md': '# hi\n' });
  const scored = scoreFile(
    signalsFor('README.md', { root, config, graph: buildGraph(root), coverage: null, log: noHistory }),
    config,
  );
  assert.equal(scored.tier, 0);
  assert.equal(scored.risk, 0);
  assert.deepEqual(scored.reasons, ['exempt by configuration']);
});
