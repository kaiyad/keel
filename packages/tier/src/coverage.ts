import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFile, normalize } from '@keel/core';

/** path -> line coverage 0..1, parsed from an lcov report. */
export function readLcov(root: string, rel: string): Map<string, number> | null {
  const full = join(root, rel);
  if (!isFile(full)) return null;
  const out = new Map<string, number>();
  let file: string | null = null;
  let found = 0;
  let hit = 0;
  const flush = () => {
    if (file !== null && found > 0) out.set(file, hit / found);
    file = null;
    found = 0;
    hit = 0;
  };
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      flush();
      file = normalize(line.slice(3).trim().replace(new RegExp(`^${escapeRe(root)}/?`), ''));
      continue;
    }
    if (line.startsWith('LF:')) found = Number(line.slice(3)) || 0;
    if (line.startsWith('LH:')) hit = Number(line.slice(3)) || 0;
    if (line.startsWith('end_of_record')) flush();
  }
  flush();
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
