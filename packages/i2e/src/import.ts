import { basename } from 'node:path';
import { asList, asString, globPrefix, parseFrontmatter } from '@keel/core';
import { ASSERTION_KINDS, type Assertion, type EvalCase } from './types.js';

export interface ImportOptions {
  /** Repo-relative path of the postmortem, recorded as the case source. */
  source: string;
  now?: string;
  extraAssertions?: Assertion[];
  prompt?: string;
  category?: string;
}

export interface ImportResult {
  case: EvalCase;
  notes: string[];
}

/**
 * Turn a postmortem into an eval case. Deliberately strict about assertions: a case
 * with nothing mechanical to check would score 100% forever and teach nothing.
 */
export function importPostmortem(text: string, opts: ImportOptions): ImportResult {
  const { data, body } = parseFrontmatter(text);
  const notes: string[] = [];
  const sections = splitSections(body);

  const incident = asString(data['incident']) ?? asString(data['id']) ?? stem(opts.source);
  const id = slug(asString(data['id']) ?? incident);
  const title = asString(data['title']) ?? firstHeading(body) ?? incident;

  const paths = uniq([
    ...asList(data['paths']),
    ...asList(data['scope']).map((g) => (g.includes('*') ? globPrefix(g) : g)).filter((p) => p !== ''),
    ...asList(data['files']),
  ]);

  const assertions: Assertion[] = [
    ...parseAssertSpecs(asList(data['assert']), notes),
    ...(opts.extraAssertions ?? []),
  ];

  const signature = asString(data['signature']) ?? sections.get('signature');
  if (assertions.length === 0 && signature !== undefined) {
    notes.push(
      'No assert: entries found; derived nothing from the signature section automatically. Patterns must be written by a human who read the incident.',
    );
  }
  if (assertions.length === 0) {
    throw new Error(
      [
        `${opts.source}: no assertions.`,
        'Add an assert: list to the postmortem frontmatter, or pass --assert kind=value, e.g.',
        '  assert:',
        '    - forbid_pattern=retry\\(.*\\)\\s*\\{[^}]*charge',
        '    - require_pattern=idempotency[_-]?key',
        `    - require_path=${paths[0] ?? 'src/path/to/file.ts'}`,
        `Valid kinds: ${ASSERTION_KINDS.join(', ')}.`,
      ].join('\n'),
    );
  }

  let prompt = opts.prompt ?? asString(data['prompt']) ?? sections.get('task');
  let needsReview = false;
  if (prompt === undefined || prompt.trim() === '') {
    prompt = synthesisePrompt(title, paths, sections, body);
    needsReview = true;
    notes.push(
      'Prompt was synthesised from the postmortem. Rewrite it as the task as it was actually handed over, or the case tests the wrong thing.',
    );
  }

  const built: EvalCase = {
    id,
    incident,
    title,
    category: opts.category ?? asString(data['category']) ?? 'uncategorised',
    source: opts.source,
    createdAt: opts.now ?? new Date().toISOString(),
    paths,
    prompt: prompt.trim(),
    assertions,
    weight: 1,
  };
  if (needsReview) built.needsReview = true;
  return { case: built, notes };
}

export function parseAssertSpecs(specs: string[], notes: string[] = []): Assertion[] {
  const out: Assertion[] = [];
  for (const spec of specs) {
    const eq = spec.indexOf('=');
    if (eq === -1) {
      notes.push(`ignored assertion "${spec}": expected kind=value`);
      continue;
    }
    const kind = spec.slice(0, eq).trim();
    const value = spec.slice(eq + 1).trim();
    if (!(ASSERTION_KINDS as readonly string[]).includes(kind)) {
      notes.push(`ignored assertion "${spec}": unknown kind "${kind}"`);
      continue;
    }
    if (value === '') {
      notes.push(`ignored assertion "${spec}": empty value`);
      continue;
    }
    out.push({ kind: kind as Assertion['kind'], value });
  }
  return out;
}

function synthesisePrompt(
  title: string,
  paths: string[],
  sections: Map<string, string>,
  body: string,
): string {
  const where = paths.length > 0 ? ` Work in ${paths.join(', ')}.` : '';
  const impact = sections.get('impact') ?? sections.get('what happened') ?? firstParagraph(body);
  return [
    `Implement the change that was being made when this incident was introduced: ${title}.${where}`,
    impact === undefined ? '' : `\nBackground from the postmortem:\n${impact}`,
    '\nShow the diff you would apply.',
  ]
    .join('\n')
    .trim();
}

function splitSections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let key: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (key !== null) out.set(key, buf.join('\n').trim());
    buf = [];
  };
  for (const line of body.split('\n')) {
    const h = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (h?.[1] !== undefined) {
      flush();
      key = h[1].toLowerCase().replace(/[^a-z ]/g, '').trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

function firstHeading(body: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(body);
  return m?.[1]?.trim();
}

function firstParagraph(body: string): string | undefined {
  const para = body
    .split('\n\n')
    .map((p) => p.trim())
    .find((p) => p !== '' && !p.startsWith('#'));
  return para;
}

function stem(path: string): string {
  return basename(path).replace(/\.[^.]+$/, '');
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter((x) => x !== ''))];
}
