/**
 * The subset of YAML that context sources are allowed to use, parsed here so the
 * toolchain has no runtime dependency. Anything outside this subset is a lint
 * error rather than a silent reinterpretation — see `ctxc lint`.
 */

export type FmValue = string | number | boolean | FmValue[] | { [key: string]: FmValue };

export interface Frontmatter {
  data: Record<string, FmValue>;
  body: string;
  /** 1-based line where the body starts, so diagnostics can point at real lines. */
  bodyLine: number;
  problems: string[];
}

const FENCE = /^---\s*$/;

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !FENCE.test(lines[0] ?? '')) {
    return { data: {}, body: text, bodyLine: 1, problems: ['no frontmatter block'] };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { data: {}, body: text, bodyLine: 1, problems: ['unterminated frontmatter block'] };
  }
  const problems: string[] = [];
  const data = parseBlock(lines.slice(1, end), 0, problems, 1);
  return {
    data,
    body: lines.slice(end + 1).join('\n').replace(/^\n+/, ''),
    bodyLine: end + 2,
    problems,
  };
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

function parseBlock(
  lines: string[],
  indent: number,
  problems: string[],
  lineOffset: number,
): Record<string, FmValue> {
  const out: Record<string, FmValue> = {};
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      i++;
      continue;
    }
    if (indentOf(raw) !== indent) {
      problems.push(`line ${lineOffset + i + 1}: unexpected indentation`);
      i++;
      continue;
    }
    const line = raw.slice(indent);
    const colon = splitKey(line);
    if (!colon) {
      problems.push(`line ${lineOffset + i + 1}: expected "key: value"`);
      i++;
      continue;
    }
    const [key, rest] = colon;
    if (rest !== '') {
      out[key] = scalar(rest);
      i++;
      continue;
    }
    // Block value: collect the more-indented run that follows.
    const child: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? '';
      if (next.trim() === '') {
        child.push('');
        j++;
        continue;
      }
      if (indentOf(next) <= indent) break;
      child.push(next);
      j++;
    }
    const childIndent = indentOf(child.find((l) => l.trim() !== '') ?? '');
    const first = (child.find((l) => l.trim() !== '') ?? '').slice(childIndent);
    if (first.startsWith('- ') || first === '-') {
      out[key] = child
        .filter((l) => l.trim() !== '')
        .map((l) => scalar(l.slice(childIndent).replace(/^-\s*/, '')));
    } else if (child.length > 0) {
      out[key] = parseBlock(child, childIndent, problems, lineOffset + i + 1);
    } else {
      out[key] = '';
    }
    i = j;
  }
  return out;
}

/** Split on the first colon that is not inside quotes. */
function splitKey(line: string): [string, string] | null {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ':') {
      const key = line.slice(0, i).trim();
      if (key === '') return null;
      return [unquote(key), line.slice(i + 1).trim()];
    }
  }
  return null;
}

function scalar(input: string): FmValue {
  const v = stripComment(input).trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return splitList(inner).map((s) => scalar(s));
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~' || v === '') return '';
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);
  return unquote(v);
}

/** Commas at depth zero, outside quotes. */
function splitList(inner: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote = '';
  let depth = 0;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = '';
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') out.push(buf);
  return out.map((s) => s.trim());
}

function stripComment(v: string): string {
  if (v.startsWith('"') || v.startsWith("'")) return v;
  const hash = v.indexOf(' #');
  return hash === -1 ? v : v.slice(0, hash);
}

function unquote(v: string): string {
  if (v.length >= 2) {
    const a = v[0];
    const z = v[v.length - 1];
    if ((a === '"' && z === '"') || (a === "'" && z === "'")) return v.slice(1, -1);
  }
  return v;
}

/** Coercions used all over the CLIs, kept in one place so they behave identically. */
export function asString(v: FmValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

export function asList(v: FmValue | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => asString(x) ?? '').filter((s) => s !== '');
  const s = asString(v);
  return s === undefined || s === '' ? [] : [s];
}

export function asRecord(v: FmValue | undefined): Record<string, FmValue> {
  if (v !== undefined && !Array.isArray(v) && typeof v === 'object') return v;
  return {};
}
