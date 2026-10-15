import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPostmortem, parseAssertSpecs } from '../dist/import.js';
import { check, touchedFromDiff } from '../dist/assert.js';
import { compare, runCases, saveRun, latestRun, summarise } from '../dist/run.js';
import { loadCases, saveCase, validate } from '../dist/cases.js';
import { markdownReport } from '../dist/report.js';
import { DEFAULT_CONFIG, type EvalCase } from '../dist/types.js';

const POSTMORTEM = `---
id: inc-2024-08-duplicate-charges
incident: INC-2024-08
title: Duplicate charges from a retry without an idempotency key
category: idempotency
scope:
  - src/payments/**
assert:
  - forbid_pattern=setTimeout\\([^)]*charge
  - require_pattern=idempotency[_-]?key
  - require_path=src/payments/charge.ts
---

## What happened

A timeout handler retried the charge call without reusing the idempotency key.

## Task

Add a retry to the charge call so transient processor timeouts do not fail the payment.
`;

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'i2e-'));
}

test('import lifts id, scope, category, assertions and the task prompt', () => {
  const { case: c, notes } = importPostmortem(POSTMORTEM, {
    source: 'postmortems/INC-2024-08.md',
    now: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(c.id, 'inc-2024-08-duplicate-charges');
  assert.equal(c.incident, 'INC-2024-08');
  assert.equal(c.category, 'idempotency');
  assert.deepEqual(c.paths, ['src/payments']);
  assert.equal(c.assertions.length, 3);
  assert.match(c.prompt, /^Add a retry to the charge call/);
  assert.equal(c.needsReview, undefined);
  assert.deepEqual(notes, []);
});

test('import synthesises a prompt and flags it for review when no task section exists', () => {
  const text = POSTMORTEM.replace(/## Task[\s\S]*$/, '');
  const { case: c, notes } = importPostmortem(text, { source: 'p.md' });
  assert.equal(c.needsReview, true);
  assert.match(c.prompt, /Implement the change that was being made/);
  assert.ok(notes.some((n) => /synthesised/.test(n)));
});

test('import refuses a postmortem with nothing mechanical to check', () => {
  const text = POSTMORTEM.replace(/assert:[\s\S]*?---/, '---');
  assert.throws(() => importPostmortem(text, { source: 'p.md' }), /no assertions/);
});

test('assert spec parsing rejects unknown kinds and reports why', () => {
  const notes: string[] = [];
  const parsed = parseAssertSpecs(['require_pattern=foo', 'nope=bar', 'malformed'], notes);
  assert.equal(parsed.length, 1);
  assert.equal(notes.length, 2);
});

test('a case with an invalid regex or no assertions fails to load', () => {
  assert.throws(() => validate({ id: 'a', title: 't', prompt: 'p', assertions: [] } as unknown as EvalCase, 'x'), /no assertions/);
  assert.throws(
    () =>
      validate(
        { id: 'a', title: 't', prompt: 'p', assertions: [{ kind: 'require_pattern', value: '([' }] } as unknown as EvalCase,
        'x',
      ),
    /not a valid regular expression/,
  );
});

test('assertions read patterns from output and paths from the diff', () => {
  const output = [
    'Adding an idempotency_key to the retry.',
    'diff --git a/src/payments/charge.ts b/src/payments/charge.ts',
    '--- a/src/payments/charge.ts',
    '+++ b/src/payments/charge.ts',
    '+  const key = idempotencyKey(req);',
  ].join('\n');
  assert.deepEqual(touchedFromDiff(output), ['src/payments/charge.ts']);
  const results = check(
    [
      { kind: 'require_pattern', value: 'idempotency[_-]?key' },
      { kind: 'forbid_pattern', value: 'setTimeout\\([^)]*charge' },
      { kind: 'require_path', value: 'src/payments/charge.ts' },
      { kind: 'forbid_path', value: 'src/payments/legacy.ts' },
    ],
    { output, touched: touchedFromDiff(output) },
  );
  assert.deepEqual(results.map((r) => r.passed), [true, true, true, true]);
});

test('run scores a replayed corpus and gates on regressions', () => {
  const root = tmp();
  const config = { ...DEFAULT_CONFIG };
  const base: EvalCase = {
    id: 'inc-1',
    incident: 'INC-1',
    title: 't',
    category: 'idempotency',
    source: 'p.md',
    createdAt: '2026-10-16T00:00:00.000Z',
    paths: ['src/payments/charge.ts'],
    prompt: 'add a retry',
    assertions: [{ kind: 'require_pattern', value: 'idempotency[_-]?key' }],
    weight: 1,
  };
  saveCase(root, config.cases, base);
  saveCase(root, config.cases, { ...base, id: 'inc-2', category: 'auth' });
  const cases = loadCases(root, config.cases);
  assert.equal(cases.length, 2);

  mkdirSync(join(root, 'captured'), { recursive: true });
  writeFileSync(join(root, 'captured', 'inc-1.txt'), 'uses an idempotency_key');
  writeFileSync(join(root, 'captured', 'inc-2.txt'), 'plain retry, no key');

  const good = runCases({
    root,
    config,
    cases,
    agent: '',
    label: 'good',
    replayDir: 'captured',
    now: new Date('2026-10-16T01:00:00.000Z'),
  });
  assert.equal(good.passed, 1);
  assert.equal(good.score, 0.5);
  assert.deepEqual(good.byCategory['idempotency'], { passed: 1, total: 1 });
  saveRun(root, config.runs, good);

  writeFileSync(join(root, 'captured', 'inc-1.txt'), 'bare retry now, key dropped');
  const worse = runCases({
    root,
    config,
    cases,
    agent: '',
    label: 'worse',
    replayDir: 'captured',
    now: new Date('2026-10-16T02:00:00.000Z'),
  });
  const cmp = compare(worse, latestRun(root, config.runs));
  assert.deepEqual(cmp.regressions, ['inc-1']);
  assert.deepEqual(cmp.fixes, []);
  assert.match(markdownReport(worse, cmp), /## Regressions/);
});

test('a missing replay output is a skipped failure, not a silent pass', () => {
  const root = tmp();
  const config = { ...DEFAULT_CONFIG };
  const c: EvalCase = {
    id: 'inc-9',
    incident: 'INC-9',
    title: 't',
    category: 'c',
    source: 'p.md',
    createdAt: 'x',
    paths: [],
    prompt: 'p',
    assertions: [{ kind: 'require_pattern', value: 'x' }],
    weight: 1,
  };
  const run = runCases({ root, config, cases: [c], agent: '', label: 'l', replayDir: 'nope' });
  assert.equal(run.passed, 0);
  assert.equal(run.results[0]?.skipped, true);
  assert.match(run.results[0]?.error ?? '', /no replay output/);
});

test('run invokes a real agent command and reads its stdout', () => {
  const root = tmp();
  const config = { ...DEFAULT_CONFIG };
  const c: EvalCase = {
    id: 'inc-live',
    incident: 'INC-L',
    title: 't',
    category: 'c',
    source: 'p.md',
    createdAt: 'x',
    paths: ['src/payments/charge.ts'],
    prompt: 'add a retry',
    assertions: [
      { kind: 'require_pattern', value: 'add a retry' },
      { kind: 'require_pattern', value: 'src/payments/charge\\.ts' },
    ],
    weight: 1,
  };
  const run = runCases({ root, config, cases: [c], agent: 'echo {{prompt}} {{paths}}', label: 'echo' });
  assert.equal(run.passed, 1, JSON.stringify(run.results, null, 2));
});

test('summarise handles an empty corpus without dividing by zero', () => {
  const run = summarise([], { at: 'now', label: 'l', agent: 'a' });
  assert.equal(run.score, 0);
  assert.equal(run.caseCount, 0);
});
