import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  asList,
  asRecord,
  asString,
  matchAny,
  parseFrontmatter,
  walk,
  type Diagnostic,
} from '@keel/core';
import { KINDS, STATUSES, type ContextDoc, type Kind, type Rule, type Status } from './types.js';

export interface LoadResult {
  docs: ContextDoc[];
  diagnostics: Diagnostic[];
  files: string[];
}

/** Read every source file, validate its frontmatter, and return what survived. */
export function loadDocs(root: string, sources: string[]): LoadResult {
  const all = walk(root, { exts: ['.md', '.markdown'] });
  const files = all.filter((f) => matchAny(sources, f));
  const docs: ContextDoc[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    const { data, body, problems } = parseFrontmatter(text);
    for (const p of problems) {
      diagnostics.push({
        severity: 'error',
        code: 'bad-frontmatter',
        message: p,
        file,
        hint: 'Context sources must open with a --- fenced block of key: value pairs.',
      });
    }
    if (problems.length > 0 && Object.keys(data).length === 0) continue;

    const id = asString(data['id']);
    const kindRaw = asString(data['kind']);
    const title = asString(data['title']);
    const owner = asString(data['owner']);
    const statusRaw = asString(data['status']) ?? 'active';

    for (const [field, value] of [
      ['id', id],
      ['kind', kindRaw],
      ['title', title],
      ['owner', owner],
    ] as const) {
      if (value === undefined || value === '') {
        diagnostics.push({
          severity: 'error',
          code: 'missing-field',
          message: `missing required field "${field}"`,
          file,
          hint: `Every context source needs id, kind, title and owner. Context without an owner cannot be deprecated by anyone.`,
        });
      }
    }
    if (id === undefined || kindRaw === undefined || title === undefined || owner === undefined) {
      continue;
    }
    if (!(KINDS as readonly string[]).includes(kindRaw)) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown-kind',
        message: `unknown kind "${kindRaw}"`,
        file,
        hint: `Use one of: ${KINDS.join(', ')}.`,
      });
      continue;
    }
    if (!(STATUSES as readonly string[]).includes(statusRaw)) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown-status',
        message: `unknown status "${statusRaw}"`,
        file,
        hint: `Use one of: ${STATUSES.join(', ')}.`,
      });
      continue;
    }
    const kind = kindRaw as Kind;
    const status = statusRaw as Status;
    const scope = asList(data['scope']);
    const rule = readRule(data['rule'] === undefined ? undefined : asRecord(data['rule']));

    if (kind === 'rule' && rule === null) {
      diagnostics.push({
        severity: 'error',
        code: 'rule-without-assertion',
        message: 'kind: rule needs a rule block with subject, directive and value',
        file,
        hint: 'A rule an agent cannot check mechanically belongs in a decision record instead.',
      });
      continue;
    }
    if (scope.length === 0 && (kind === 'rule' || kind === 'ownership' || kind === 'deprecation')) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-scope',
        message: `kind: ${kind} needs at least one scope glob`,
        file,
        hint: 'Unscoped rules are retrieved for every change and crowd out the relevant ones.',
      });
      continue;
    }

    const doc: ContextDoc = {
      id,
      kind,
      title,
      owner,
      status,
      scope,
      supersedes: asList(data['supersedes']),
      body: body.trim(),
      file,
    };
    const expires = asString(data['expires']);
    if (expires !== undefined && expires !== '') doc.expires = expires;
    const incident = asString(data['incident']);
    if (incident !== undefined && incident !== '') doc.incident = incident;
    if (rule !== null) doc.rule = rule;
    docs.push(doc);
  }

  return { docs: docs.sort((a, b) => a.id.localeCompare(b.id)), diagnostics, files };
}

function readRule(raw: Record<string, unknown> | undefined): Rule | null {
  if (raw === undefined) return null;
  const subject = typeof raw['subject'] === 'string' ? raw['subject'] : undefined;
  const directive = raw['directive'];
  const value = typeof raw['value'] === 'string' ? raw['value'] : undefined;
  if (subject === undefined || value === undefined) return null;
  if (directive !== 'require' && directive !== 'forbid') return null;
  return { subject, directive, value };
}
