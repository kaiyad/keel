import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isFile } from '@keel/core';

export interface RetrievalEvent {
  at: string;
  id: string;
  agent?: string;
  path?: string;
}

/** id -> most recent retrieval timestamp. Absent file means no telemetry yet. */
export function readRetrieval(root: string, logPath: string): Map<string, string> | null {
  const full = join(root, logPath);
  if (!isFile(full)) return null;
  const seen = new Map<string, string>();
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let event: RetrievalEvent;
    try {
      event = JSON.parse(line) as RetrievalEvent;
    } catch {
      continue;
    }
    if (typeof event.id !== 'string' || typeof event.at !== 'string') continue;
    const prev = seen.get(event.id);
    if (prev === undefined || prev < event.at) seen.set(event.id, event.at);
  }
  return seen;
}

export function recordRetrieval(
  root: string,
  logPath: string,
  ids: string[],
  meta: { agent?: string; path?: string; at?: string } = {},
): void {
  const full = join(root, logPath);
  mkdirSync(dirname(full), { recursive: true });
  const at = meta.at ?? new Date().toISOString();
  const lines = ids.map((id) => {
    const event: RetrievalEvent = { at, id };
    if (meta.agent !== undefined) event.agent = meta.agent;
    if (meta.path !== undefined) event.path = meta.path;
    return JSON.stringify(event);
  });
  if (lines.length > 0) appendFileSync(full, `${lines.join('\n')}\n`);
}
