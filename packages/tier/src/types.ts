export interface Policy {
  /** Which model is allowed to write here. */
  model: 'cheap' | 'standard' | 'strongest';
  reviewers: number;
  autoMerge: boolean;
  /** The test-writing agent must not see the implementation (oracle isolation). */
  oracleIsolation: boolean;
  /** Two approvals from different people, for anything irreversible. */
  dualKey: boolean;
  /** A human types here; the model may propose only. */
  humanAuthoring: boolean;
  summary: string;
}

export interface Signals {
  path: string;
  /** Files in the repository that import this one. */
  dependents: number;
  /** Commits whose subject looks like a fix, revert or incident. */
  fixCommits: number;
  commits: number;
  /** Line coverage 0..1, or null when no coverage report was found. */
  coverage: number | null;
  reversible: boolean;
  sensitive: boolean;
  exempt: boolean;
  /** Reasons, each already phrased for a reviewer. */
  notes: string[];
}

export interface Scored {
  signals: Signals;
  /** Weighted risk 0..1, before the floors are applied. */
  risk: number;
  tier: number;
  /** Why this tier, in order of contribution. */
  reasons: string[];
  components: Record<string, number>;
}

export interface Config {
  /** Globs where shallow understanding is catastrophic — the manual load-bearing core. */
  sensitive: string[];
  /** Globs whose effects cannot be rolled back by reverting the commit. */
  irreversible: string[];
  /** Globs that carry no production risk at all, and so skip scoring entirely. */
  exempt: string[];
  /** Commit subjects that indicate this file has hurt you before. */
  incidentPattern: string;
  coverageFile: string;
  /** Dependents count that saturates the blast-radius signal. */
  dependentsCeiling: number;
  /** Share of a file's commits that must look like fixes to saturate that signal. */
  fixShareCeiling: number;
  /** Fix commits that saturate the signal on a file with little history. */
  fixCountCeiling: number;
  weights: { blast: number; incidents: number; coverage: number; irreversible: number; sensitive: number };
  /** Lower bound of each tier, index 1..3; below thresholds[0] is tier 0. */
  thresholds: [number, number, number];
  policies: Record<string, Policy>;
}

export const DEFAULT_POLICIES: Record<string, Policy> = {
  '0': {
    model: 'cheap',
    reviewers: 0,
    autoMerge: true,
    oracleIsolation: false,
    dualKey: false,
    humanAuthoring: false,
    summary: 'Well-covered leaf code. Cheap model, auto-merge on green.',
  },
  '1': {
    model: 'standard',
    reviewers: 1,
    autoMerge: false,
    oracleIsolation: false,
    dualKey: false,
    humanAuthoring: false,
    summary: 'Ordinary code. One reviewer, no auto-merge.',
  },
  '2': {
    model: 'strongest',
    reviewers: 1,
    autoMerge: false,
    oracleIsolation: true,
    dualKey: false,
    humanAuthoring: false,
    summary: 'Wide blast radius or a history of incidents. Strongest model, tests written in isolation.',
  },
  '3': {
    model: 'strongest',
    reviewers: 2,
    autoMerge: false,
    oracleIsolation: true,
    dualKey: true,
    humanAuthoring: true,
    summary: 'Load-bearing and hard to reverse. A human types; two approvals; dual-key on release.',
  },
};

export const DEFAULT_CONFIG: Config = {
  sensitive: [
    '**/payments/**',
    '**/billing/**',
    '**/auth/**',
    '**/session/**',
    '**/crypto/**',
    '**/idempotency/**',
    '**/retry/**',
    '**/ledger/**',
    '**/migrations/**',
  ],
  exempt: ['**/*.md', '**/*.mdx', '**/*.txt', 'docs/**', 'LICENSE'],
  irreversible: [
    '**/migrations/**',
    '**/*.sql',
    '**/*.tf',
    'infra/**',
    'terraform/**',
    'charts/**',
    '.github/workflows/**',
    '**/Dockerfile',
  ],
  incidentPattern: '\\b(fix|hotfix|revert|regress|incident|outage|bug|INC-\\d+)\\b',
  coverageFile: 'coverage/lcov.info',
  dependentsCeiling: 20,
  fixShareCeiling: 0.3,
  fixCountCeiling: 3,
  weights: { blast: 0.25, incidents: 0.25, coverage: 0.2, irreversible: 0.15, sensitive: 0.15 },
  thresholds: [0.2, 0.45, 0.7],
  policies: DEFAULT_POLICIES,
};
