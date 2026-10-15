import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDocs } from '../dist/load.js';
import { lint } from '../dist/lint.js';
import { compile, renderBundle } from '../dist/bundle.js';
import { pack, coverage, applicable } from '../dist/pack.js';
import { readRetrieval, recordRetrieval } from '../dist/retrieval.js';
import { DEFAULT_CONFIG } from '../dist/types.js';

const TODAY = '2026-10-16';

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxc-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function doc(front: string, body = 'Body.'): string {
  return `---\n${front}\n---\n\n${body}\n`;
}

const config = { ...DEFAULT_CONFIG, sources: ['context/**/*.md'] };

function run(files: Record<string, string>, over: Partial<typeof config> = {}) {
  const cfg = { ...config, ...over };
  const root = repo(files);
  const { docs, diagnostics } = loadDocs(root, cfg.sources);
  const codeFiles = Object.keys(files).filter((f) => f.endsWith('.ts'));
  const diags = [
    ...diagnostics,
    ...lint({ docs, config: cfg, codeFiles, retrieval: readRetrieval(root, cfg.retrievalLog), today: TODAY }),
  ];
  return { root, docs, diags, codes: diags.map((d) => d.code) };
}

test('loads a well-formed corpus with no errors', () => {
  const { docs, diags } = run({
    'src/payments/post.ts': 'export const x = 1;',
    'context/rules/a.md': doc(
      ['id: rule-a', 'kind: rule', 'title: No unbounded retry', 'owner: payments', 'scope:', '  - src/payments/**', 'rule:', '  subject: retry-policy', '  directive: forbid', '  value: unbounded-retry'].join('\n'),
    ),
  });
  assert.equal(docs.length, 1);
  assert.deepEqual(diags.filter((d) => d.severity === 'error'), []);
  assert.equal(docs[0]?.rule?.directive, 'forbid');
});

test('a rule with no assertion and a rule with no scope are both rejected', () => {
  const { codes } = run({
    'context/rules/a.md': doc(['id: a', 'kind: rule', 'title: t', 'owner: o', 'scope:', '  - src/**'].join('\n')),
    'context/rules/b.md': doc(
      ['id: b', 'kind: rule', 'title: t', 'owner: o', 'rule:', '  subject: s', '  directive: require', '  value: v'].join('\n'),
    ),
  });
  assert.ok(codes.includes('rule-without-assertion'));
  assert.ok(codes.includes('missing-scope'));
});

test('contradictory rules over overlapping scopes fail the build', () => {
  const { diags } = run({
    'src/payments/post.ts': '1',
    'context/rules/a.md': doc(
      ['id: a', 'kind: rule', 'title: forbid', 'owner: o', 'scope:', '  - src/**', 'rule:', '  subject: retry-policy', '  directive: forbid', '  value: unbounded-retry'].join('\n'),
    ),
    'context/rules/b.md': doc(
      ['id: b', 'kind: rule', 'title: require', 'owner: o', 'scope:', '  - src/payments/**', 'rule:', '  subject: retry-policy', '  directive: require', '  value: unbounded-retry'].join('\n'),
    ),
  });
  const hit = diags.find((d) => d.code === 'contradictory-rule');
  assert.ok(hit, 'expected a contradictory-rule diagnostic');
  assert.equal(hit?.severity, 'error');
});

test('non-overlapping scopes may disagree freely', () => {
  const { codes } = run({
    'src/payments/a.ts': '1',
    'src/web/a.ts': '1',
    'context/rules/a.md': doc(
      ['id: a', 'kind: rule', 'title: t', 'owner: o', 'scope:', '  - src/payments/**', 'rule:', '  subject: s', '  directive: forbid', '  value: v'].join('\n'),
    ),
    'context/rules/b.md': doc(
      ['id: b', 'kind: rule', 'title: t', 'owner: o', 'scope:', '  - src/web/**', 'rule:', '  subject: s', '  directive: require', '  value: v'].join('\n'),
    ),
  });
  assert.ok(!codes.includes('contradictory-rule'));
});

test('duplicate ids, dangling and live supersedes are errors', () => {
  const { codes } = run({
    'src/a.ts': '1',
    'context/a.md': doc(['id: dup', 'kind: decision', 'title: t', 'owner: o'].join('\n')),
    'context/b.md': doc(['id: dup', 'kind: decision', 'title: t', 'owner: o'].join('\n')),
    'context/c.md': doc(['id: c', 'kind: decision', 'title: t', 'owner: o', 'supersedes: nope'].join('\n')),
    'context/d.md': doc(['id: d', 'kind: decision', 'title: t', 'owner: o', 'supersedes: dup'].join('\n')),
  });
  assert.ok(codes.includes('duplicate-id'));
  assert.ok(codes.includes('dangling-supersedes'));
  assert.ok(codes.includes('superseded-but-active'));
});

test('expiry is the only thing that evicts context', () => {
  const { diags } = run({
    'src/a.ts': '1',
    'context/a.md': doc(['id: a', 'kind: decision', 'title: t', 'owner: o', 'expires: 2026-01-01'].join('\n')),
    'context/b.md': doc(['id: b', 'kind: decision', 'title: t', 'owner: o', 'expires: 2026-10-30'].join('\n')),
    'context/c.md': doc(['id: c', 'kind: decision', 'title: t', 'owner: o', 'expires: 2027-10-30'].join('\n')),
  });
  assert.equal(diags.find((d) => d.code === 'expired')?.severity, 'error');
  assert.equal(diags.find((d) => d.code === 'expiring-soon')?.severity, 'warn');
  assert.equal(diags.filter((d) => d.code === 'expired').length, 1);
});

test('scopes that match no file are reported', () => {
  const { codes } = run({
    'src/a.ts': '1',
    'context/a.md': doc(
      ['id: a', 'kind: ownership', 'title: t', 'owner: o', 'scope:', '  - src/deleted/**'].join('\n'),
    ),
  });
  assert.ok(codes.includes('unknown-scope'));
});

test('retrieval telemetry drives staleness, and is absent by default', () => {
  const files = {
    'src/a.ts': '1',
    'context/a.md': doc(['id: a', 'kind: decision', 'title: t', 'owner: o'].join('\n')),
  };
  const first = run(files);
  assert.ok(first.codes.includes('no-retrieval-telemetry'));

  recordRetrieval(first.root, config.retrievalLog, ['a'], { at: '2026-01-01T00:00:00.000Z' });
  const log = readRetrieval(first.root, config.retrievalLog);
  assert.equal(log?.get('a'), '2026-01-01T00:00:00.000Z');

  const { docs } = loadDocs(first.root, config.sources);
  const diags = lint({ docs, config, codeFiles: ['src/a.ts'], retrieval: log, today: TODAY });
  assert.equal(diags.find((d) => d.code === 'stale-retrieval')?.severity, 'warn');

  recordRetrieval(first.root, config.retrievalLog, ['a'], { at: '2026-10-15T00:00:00.000Z' });
  const fresh = lint({
    docs,
    config,
    codeFiles: ['src/a.ts'],
    retrieval: readRetrieval(first.root, config.retrievalLog),
    today: TODAY,
  });
  assert.ok(!fresh.some((d) => d.code === 'stale-retrieval'));
});

test('compile is content-addressed and pack routes by scope', () => {
  const { docs } = run({
    'src/payments/post.ts': '1',
    'src/web/page.ts': '1',
    'context/a.md': doc(
      ['id: pay', 'kind: rule', 'title: t', 'owner: o', 'scope:', '  - src/payments/**', 'rule:', '  subject: s', '  directive: forbid', '  value: v'].join('\n'),
    ),
    'context/b.md': doc(['id: glob', 'kind: taste', 'title: t', 'owner: o'].join('\n')),
    'context/c.md': doc(['id: old', 'kind: decision', 'title: t', 'owner: o', 'status: superseded'].join('\n')),
  });
  const bundle = compile(docs);
  assert.equal(bundle.docCount, 2, 'superseded docs are not compiled');
  assert.equal(compile(docs).version, bundle.version, 'version is content-addressed, not time-addressed');

  assert.deepEqual(applicable(bundle, 'src/payments/post.ts').map((d) => d.id), ['pay', 'glob']);
  assert.deepEqual(applicable(bundle, 'src/web/page.ts').map((d) => d.id), ['glob']);

  const { markdown } = pack(bundle, ['src/payments/post.ts']);
  assert.match(markdown, /\*\*FORBID\*\* s = `v`/);
  assert.match(renderBundle(bundle), /# Compiled context `/);

  const cov = coverage(bundle, ['src/payments/post.ts', 'src/web/page.ts']);
  assert.deepEqual(cov, { covered: 1, total: 2 });
});
