export const FRICTION_KINDS = ['tool-error', 'repeat-command', 'edit-churn', 'test-loop'] as const;
export type FrictionKind = (typeof FRICTION_KINDS)[number];

/** One tool call, paired with its result, as reconstructed from a transcript. */
export interface Call {
  id: string;
  tool: string;
  at: number;
  /** Wall-clock until the agent's next action, capped by maxGapMs. */
  durationMs: number;
  isError: boolean;
  paths: string[];
  command?: string;
  session: string;
  cwd: string;
  branch?: string;
}

export interface FrictionEvent {
  kind: FrictionKind;
  /** Module the lost time is charged to — a path prefix, or "unknown". */
  module: string;
  path: string;
  lostMs: number;
  at: number;
  session: string;
  tool: string;
  /** One line a human can act on, e.g. the failing command. */
  detail: string;
}

export interface ModuleSummary {
  module: string;
  lostMs: number;
  events: number;
  byKind: Record<FrictionKind, number>;
  sessions: number;
  topDetails: string[];
}

export interface ScanSummary {
  scannedSessions: number;
  scannedCalls: number;
  observedMs: number;
  lostMs: number;
  since?: string;
  modules: ModuleSummary[];
  events: FrictionEvent[];
}

export interface ScanOptions {
  /** Only count sessions whose cwd is inside this directory. */
  repo?: string;
  sinceMs?: number;
  /** Path-prefix depth that defines a module. */
  depth: number;
  /** Cap on a single call's attributed duration, so a human coffee break is not "agent time". */
  maxGapMs: number;
  /** Nth and later edits of one file in one session count as churn. */
  churnThreshold: number;
  /** Nth and later identical commands in one session count as repeats. */
  repeatThreshold: number;
}

export const DEFAULT_SCAN: ScanOptions = {
  depth: 2,
  maxGapMs: 300_000,
  churnThreshold: 3,
  repeatThreshold: 2,
};
