export const KINDS = ['decision', 'incident', 'deprecation', 'ownership', 'rule', 'taste'] as const;
export type Kind = (typeof KINDS)[number];

export const STATUSES = ['active', 'draft', 'superseded'] as const;
export type Status = (typeof STATUSES)[number];

export interface Rule {
  subject: string;
  directive: 'require' | 'forbid';
  value: string;
}

export interface ContextDoc {
  id: string;
  kind: Kind;
  title: string;
  owner: string;
  status: Status;
  scope: string[];
  expires?: string;
  supersedes: string[];
  rule?: Rule;
  /** Incident identifier, so counterfactual postmortems can join back to it. */
  incident?: string;
  body: string;
  file: string;
}

export interface Bundle {
  /** Content hash of the compiled docs. Agents pin this; CI compares it. */
  version: string;
  generatedAt: string;
  docCount: number;
  docs: ContextDoc[];
  /** subject -> the active rules asserted about it, for fast conflict checks. */
  rulesBySubject: Record<string, Rule[]>;
}

export interface Config {
  sources: string[];
  out: string;
  codeRoots: string[];
  codeExts: string[];
  staleDays: number;
  expiringWithinDays: number;
  retrievalLog: string;
}

export const DEFAULT_CONFIG: Config = {
  sources: ['context/**/*.md'],
  out: '.keel/context',
  codeRoots: ['.'],
  codeExts: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs', '.sql', '.tf'],
  staleDays: 90,
  expiringWithinDays: 30,
  retrievalLog: '.keel/retrieval.jsonl',
};
