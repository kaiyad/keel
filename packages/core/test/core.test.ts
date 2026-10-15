import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, asList, asRecord, asString } from '../dist/fm.js';
import { matchGlob, scopesOverlap, globLiteral, globPrefix } from '../dist/globs.js';
import { table, bar } from '../dist/out.js';

test('frontmatter: scalars, lists, nested maps', () => {
  const { data, body, problems } = parseFrontmatter(
    [
      '---',
      'id: adr-0014',
      'kind: decision',
      'owner: "payments-core"',
      'expires: 2026-12-01',
      'active: true',
      'weight: 0.5',
      'scope:',
      '  - src/payments/**',
      '  - src/ledger/**',
      'inline: [a, b, c]',
      'rule:',
      '  subject: retry-policy',
      '  directive: forbid',
      '  value: unbounded-retry',
      '# a comment',
      '---',
      '',
      'Body text.',
    ].join('\n'),
  );
  assert.deepEqual(problems, []);
  assert.equal(data['id'], 'adr-0014');
  assert.equal(data['owner'], 'payments-core');
  assert.equal(data['expires'], '2026-12-01');
  assert.equal(data['active'], true);
  assert.equal(data['weight'], 0.5);
  assert.deepEqual(asList(data['scope']), ['src/payments/**', 'src/ledger/**']);
  assert.deepEqual(asList(data['inline']), ['a', 'b', 'c']);
  assert.equal(asString(asRecord(data['rule'])['directive']), 'forbid');
  assert.equal(body, 'Body text.');
});

test('frontmatter: missing and unterminated blocks are reported, not thrown', () => {
  assert.deepEqual(parseFrontmatter('no fence here').problems, ['no frontmatter block']);
  assert.deepEqual(parseFrontmatter('---\nid: x\n').problems, ['unterminated frontmatter block']);
});

test('globs: segment and recursive wildcards', () => {
  assert.ok(matchGlob('src/payments/**', 'src/payments/ledger/post.ts'));
  assert.ok(matchGlob('src/payments/**', 'src/payments/post.ts'));
  assert.ok(!matchGlob('src/payments/*', 'src/payments/ledger/post.ts'));
  assert.ok(matchGlob('**/*.sql', 'db/migrations/0001_init.sql'));
  assert.ok(matchGlob('**/*.sql', 'init.sql'));
  assert.ok(!matchGlob('**/*.sql', 'init.ts'));
});

test('globs: overlap detection drives contradiction checks', () => {
  assert.ok(scopesOverlap('src/**', 'src/payments/**'));
  assert.ok(scopesOverlap('src/payments/**', 'src/**'));
  assert.ok(!scopesOverlap('src/payments/**', 'src/web/**'));
  assert.ok(scopesOverlap('**/*.ts', 'src/payments/post.ts'));
  assert.equal(globLiteral('src/payments/**'), 'src/payments/x');
  assert.equal(globPrefix('src/payments/**'), 'src/payments');
});

test('table pads to the widest cell and bar is clamped', () => {
  const rendered = table([{ head: 'a' }, { head: 'bb' }], [['xxx', 'y']]);
  assert.match(rendered.split('\n')[2] ?? '', /^xxx {2}y$/);
  assert.equal(bar(2, 4), '████');
  assert.equal(bar(-1, 4).replace(/\u001b\[[0-9;]*m/g, ''), '····');
});
