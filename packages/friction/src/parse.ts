import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { isDir, normalize } from '@keel/core';
import type { Call } from './types.js';

/** Where Claude Code keeps session transcripts. */
export function defaultTranscriptDir(home: string): string {
  return join(home, '.claude', 'projects');
}

export function transcriptFiles(dir: string): string[] {
  if (!isDir(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop();
    if (d === undefined) break;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
  }
  return out.sort();
}

interface Line {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
  message?: { content?: unknown };
}

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|rs|c|h|cc|cpp|cs|php|swift|scala|sql|tf|yaml|yml|json|md|sh|toml|gradle|mjs)$/i;

const TEST_COMMAND = /\b(npm (run )?test|npm t\b|pytest|jest|vitest|go test|cargo test|mvn test|gradle test|rspec|tox|make test)/;

/**
 * Reconstruct tool calls from one transcript. Durations come from the gap to the
 * agent's next action, capped, because an uncapped gap measures the human.
 */
export function parseTranscript(path: string, maxGapMs: number): Call[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const pending = new Map<string, Call>();
  const order: Call[] = [];

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    const at = line.timestamp === undefined ? NaN : Date.parse(line.timestamp);
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'tool_use' && typeof b['id'] === 'string' && typeof b['name'] === 'string') {
        const input = (typeof b['input'] === 'object' && b['input'] !== null ? b['input'] : {}) as Record<string, unknown>;
        const command = typeof input['command'] === 'string' ? input['command'] : undefined;
        const call: Call = {
          id: b['id'],
          tool: b['name'],
          at: Number.isNaN(at) ? 0 : at,
          durationMs: 0,
          isError: false,
          paths: pathsFrom(input, line.cwd ?? ''),
          session: line.sessionId ?? path,
          cwd: line.cwd ?? '',
        };
        if (command !== undefined) call.command = command;
        if (line.gitBranch !== undefined) call.branch = line.gitBranch;
        pending.set(call.id, call);
        order.push(call);
        continue;
      }
      if (b['type'] === 'tool_result' && typeof b['tool_use_id'] === 'string') {
        const call = pending.get(b['tool_use_id']);
        if (call === undefined) continue;
        // Transcripts have carried is_error as both a boolean and the string "True".
        const flag = b['is_error'];
        call.isError = flag === true || flag === 'True' || flag === 'true';
        if (!Number.isNaN(at) && call.at > 0) {
          call.durationMs = Math.min(Math.max(0, at - call.at), maxGapMs);
        }
      }
    }
  }
  return order;
}

export function isTestCommand(command: string | undefined): boolean {
  return command !== undefined && TEST_COMMAND.test(command);
}

/** Every repo-relative path a tool call plausibly concerns, at most three. */
export function pathsFrom(input: Record<string, unknown>, cwd: string): string[] {
  const out: string[] = [];
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const v = input[key];
    if (typeof v === 'string' && v !== '') out.push(v);
  }
  const command = input['command'];
  if (typeof command === 'string') {
    for (const token of command.match(/[\w./@-]+/g) ?? []) {
      if (CODE_EXT.test(token)) out.push(token);
    }
  }
  const rel = out
    .map((p) => toRelative(p, cwd))
    .filter((p) => p !== '' && !p.startsWith('..') && !p.startsWith('/'));
  return [...new Set(rel)].slice(0, 3);
}

function toRelative(p: string, cwd: string): string {
  if (isAbsolute(p)) return cwd === '' ? '' : normalize(relative(cwd, p));
  return normalize(p.replace(/^\.\//, ''));
}

/** First `depth` segments of a path — the unit platform work is funded in. */
export function moduleOf(path: string, depth: number): string {
  if (path === '') return 'unknown';
  const parts = normalize(path).split('/');
  if (parts.length <= 1) return parts[0] ?? 'unknown';
  return parts.slice(0, Math.max(1, depth)).join('/');
}
