export const ASSERTION_KINDS = [
  'require_pattern',
  'forbid_pattern',
  'require_path',
  'forbid_path',
] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export interface Assertion {
  kind: AssertionKind;
  /** Regular expression for the pattern kinds, a repo-relative path for the path kinds. */
  value: string;
  /** Why this assertion exists — quoted from the postmortem wherever possible. */
  why?: string;
}

export interface EvalCase {
  id: string;
  incident: string;
  title: string;
  category: string;
  /** Where the case came from, so a reader can go back to the postmortem. */
  source: string;
  createdAt: string;
  /** Files the incident touched; handed to the agent as the area of work. */
  paths: string[];
  /** The task as it would have been handed to an agent before the incident. */
  prompt: string;
  assertions: Assertion[];
  weight: number;
  /** Set by `i2e import` when the prompt was synthesised and a human should rewrite it. */
  needsReview?: boolean;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  detail: string;
}

export interface CaseResult {
  id: string;
  category: string;
  passed: boolean;
  skipped?: boolean;
  durationMs: number;
  assertions: AssertionResult[];
  /** Truncated agent output, kept so a failure can be read without re-running. */
  output: string;
  error?: string;
}

export interface Run {
  at: string;
  label: string;
  agent: string;
  /** The compiled-context version the agent ran against, when ctxc is in use. */
  contextVersion?: string;
  caseCount: number;
  passed: number;
  score: number;
  byCategory: Record<string, { passed: number; total: number }>;
  results: CaseResult[];
}

export interface Config {
  cases: string;
  runs: string;
  agent: string;
  timeoutMs: number;
  outputLimit: number;
}

export const DEFAULT_CONFIG: Config = {
  cases: 'evals/cases',
  runs: 'evals/runs',
  agent: '',
  timeoutMs: 600_000,
  outputLimit: 20_000,
};
