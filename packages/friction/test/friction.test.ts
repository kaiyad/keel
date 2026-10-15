import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moduleOf, parseTranscript, pathsFrom, isTestCommand } from '../dist/parse.js';
import { aggregate, detect } from '../dist/aggregate.js';
import { parseSince, scan } from '../dist/scan.js';
import { DEFAULT_SCAN } from '../dist/types.js';

const CWD = '/repo';

/** Build a transcript in the real Claude Code shape: tool_use then tool_result. */
function transcript(
  steps: { tool: string; input: Record<string, unknown>; isError?: boolean; gapSec?: number }[],
): string {
  let t = Date.parse('2026-10-16T09:00:00.000Z');
  const lines: string[] = [];
  steps.forEach((step, i) => {
    const id = `toolu_${i}`;
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(t).toISOString(),
        cwd: CWD,
        sessionId: 's1',
        gitBranch: 'main',
        message: { content: [{ type: 'tool_use', id, name: step.tool, input: step.input }] },
      }),
    );
    t += (step.gapSec ?? 10) * 1000;
    lines.push(
      JSON.stringify({
        type: 'user',
        timestamp: new Date(t).toISOString(),
        cwd: CWD,
        sessionId: 's1',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: id, content: 'out', is_error: step.isError === true ? 'True' : 'False' },
          ],
        },
      }),
    );
  });
  return `${lines.join('\n')}\n`;
}

function write(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'friction-'));
  writeFileSync(join(dir, 's1.jsonl'), body);
  return dir;
}

test('paths come from file_path and from path-shaped tokens in a command', () => {
  assert.deepEqual(pathsFrom({ file_path: '/repo/src/payments/charge.ts' }, CWD), ['src/payments/charge.ts']);
  assert.deepEqual(pathsFrom({ command: 'npx tsc -p packages/core/tsconfig.json' }, CWD), ['packages/core/tsconfig.json']);
  assert.deepEqual(pathsFrom({ file_path: '/elsewhere/x.ts' }, CWD), []);
  assert.ok(isTestCommand('npm test -w @keel/core'));
  assert.ok(!isTestCommand('ls -la'));
  assert.equal(moduleOf('src/payments/charge.ts', 2), 'src/payments');
  assert.equal(moduleOf('README.md', 2), 'README.md');
  assert.equal(moduleOf('', 2), 'unknown');
});

test('a failing tool call is charged to its file, capped at max-gap', () => {
  const dir = write(
    transcript([{ tool: 'Edit', input: { file_path: '/repo/src/payments/charge.ts' }, isError: true, gapSec: 90 }]),
  );
  const calls = parseTranscript(join(dir, 's1.jsonl'), DEFAULT_SCAN.maxGapMs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.isError, true);
  assert.equal(calls[0]?.durationMs, 90_000);

  const capped = parseTranscript(join(dir, 's1.jsonl'), 30_000);
  assert.equal(capped[0]?.durationMs, 30_000, 'an idle gap must not be counted as agent time');

  const events = detect(calls, DEFAULT_SCAN);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'tool-error');
  assert.equal(events[0]?.module, 'src/payments');
  assert.equal(events[0]?.lostMs, 90_000);
});

test('repeated commands, edit churn and test loops are each counted once per call', () => {
  const calls = parseTranscript(
    join(
      write(
        transcript([
          { tool: 'Bash', input: { command: 'npm run build -w @keel/core' } },
          { tool: 'Bash', input: { command: 'npm run build -w @keel/core' } },
          { tool: 'Bash', input: { command: 'npm run build -w @keel/core' } },
          { tool: 'Edit', input: { file_path: '/repo/src/payments/charge.ts' } },
          { tool: 'Edit', input: { file_path: '/repo/src/payments/charge.ts' } },
          { tool: 'Edit', input: { file_path: '/repo/src/payments/charge.ts' } },
          { tool: 'Bash', input: { command: 'npm test' } },
          { tool: 'Bash', input: { command: 'npm test -w a' } },
          { tool: 'Bash', input: { command: 'npm test -w b' } },
        ]),
      ),
      's1.jsonl',
    ),
    DEFAULT_SCAN.maxGapMs,
  );
  const events = detect(calls, DEFAULT_SCAN);
  const kinds = events.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'repeat-command').length, 2, 'the 2nd and 3rd identical commands');
  assert.equal(kinds.filter((k) => k === 'edit-churn').length, 1, 'only the 3rd edit of the file');
  assert.equal(kinds.filter((k) => k === 'test-loop').length, 1, 'only the 3rd test run');
  assert.equal(events.length, 4, 'no call produces two events');

  const modules = aggregate(events);
  const payments = modules.find((m) => m.module === 'src/payments');
  assert.ok(payments !== undefined, 'the edited file is charged to its module');
  assert.ok(payments.lostMs > 0);
  assert.equal(payments.byKind['edit-churn'], 1);
  // The repeated build command names no source file, so its cost is charged to
  // "unknown" rather than guessed at.
  assert.ok(modules.some((m) => m.module === 'unknown' && m.byKind['repeat-command'] === 2));
});

test('scan filters by repo and by window, and never divides by zero', () => {
  const dir = write(transcript([{ tool: 'Bash', input: { command: 'false' }, isError: true }]));
  const inside = scan({ ...DEFAULT_SCAN, transcriptDir: dir, repo: CWD });
  assert.equal(inside.scannedCalls, 1);
  assert.equal(inside.scannedSessions, 1);

  const outside = scan({ ...DEFAULT_SCAN, transcriptDir: dir, repo: '/somewhere/else' });
  assert.equal(outside.scannedCalls, 0);
  assert.equal(outside.lostMs, 0);
  assert.deepEqual(outside.modules, []);

  const future = scan({ ...DEFAULT_SCAN, transcriptDir: dir, sinceMs: Date.parse('2030-01-01') });
  assert.equal(future.scannedCalls, 0);
});

test('malformed and unknown lines are skipped rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'friction-'));
  writeFileSync(
    join(dir, 'broken.jsonl'),
    ['not json', '{}', JSON.stringify({ type: 'attachment' }), JSON.stringify({ type: 'assistant', message: { content: 'text' } })].join('\n'),
  );
  assert.deepEqual(parseTranscript(join(dir, 'broken.jsonl'), DEFAULT_SCAN.maxGapMs), []);
  assert.equal(scan({ ...DEFAULT_SCAN, transcriptDir: dir }).scannedCalls, 0);
});

test('since accepts durations and dates', () => {
  const now = Date.parse('2026-10-16T00:00:00.000Z');
  assert.equal(parseSince('30d', now), now - 30 * 86_400_000);
  assert.equal(parseSince('12h', now), now - 12 * 3_600_000);
  assert.equal(parseSince('2026-10-01', now), Date.parse('2026-10-01'));
  assert.equal(parseSince('yesterday', now), null);
});
