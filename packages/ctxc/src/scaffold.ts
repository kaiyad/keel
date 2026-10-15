import { join } from 'node:path';
import { isFile, writeJson, writeText } from '@keel/core';
import { DEFAULT_CONFIG } from './types.js';

const DECISION = `---
id: adr-0001-ledger-is-append-only
kind: decision
title: The ledger is append-only
owner: payments-core
status: active
scope:
  - src/payments/**
---

Entries are never updated or deleted. A correction is a new, opposing entry that
references the one it corrects.

**Why not the alternative:** mutable rows would make the daily reconciliation job
cheaper to write and impossible to audit. We chose the slower read path.
`;

const RULE = `---
id: rule-no-unbounded-retry
kind: rule
title: No unbounded retries against the payment processor
owner: payments-core
status: active
scope:
  - src/payments/**
expires: 2027-06-30
rule:
  subject: retry-policy
  directive: forbid
  value: unbounded-retry
---

Every call to the processor carries a bounded retry budget and an idempotency key.
Retrying without a key duplicated 1,400 charges in INC-2024-08.
`;

const INCIDENT = `---
id: inc-2024-08-duplicate-charges
kind: incident
title: Duplicate charges from a retry without an idempotency key
owner: payments-core
status: active
incident: INC-2024-08
scope:
  - src/payments/**
---

A timeout handler retried the charge call without reusing the idempotency key.
1,400 customers were charged twice over nineteen minutes.

**Signature to look for:** a retry loop constructed inside the error branch,
with the request body rebuilt rather than reused.
`;

const DEPRECATION = `---
id: dep-legacy-fx-client
kind: deprecation
title: legacy FX client is deprecated
owner: treasury
status: active
scope:
  - src/fx/legacy/**
expires: 2026-12-31
---

Use \`src/fx/client.ts\`. The legacy client rounds half-down and has no retry budget.
`;

const OWNERSHIP = `---
id: own-payments
kind: ownership
title: Payments is owned by payments-core
owner: payments-core
status: active
scope:
  - src/payments/**
---

Reviews on this path need one payments-core approver. Pages go to the payments rota.
`;

const WORKFLOW = `name: context
on: [pull_request]
jobs:
  compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx ctxc build --strict
      # The compiled artifact is what agents consume; publish it like any build output.
      - uses: actions/upload-artifact@v4
        with:
          name: context
          path: .keel/context
`;

export function scaffold(root: string): string[] {
  const written: string[] = [];
  const put = (rel: string, body: string) => {
    const full = join(root, rel);
    if (isFile(full)) return;
    writeText(full, body);
    written.push(rel);
  };
  const cfg = join(root, '.keel', 'ctxc.json');
  if (!isFile(cfg)) {
    writeJson(cfg, {
      sources: DEFAULT_CONFIG.sources,
      out: DEFAULT_CONFIG.out,
      codeRoots: DEFAULT_CONFIG.codeRoots,
      staleDays: DEFAULT_CONFIG.staleDays,
    });
    written.push('.keel/ctxc.json');
  }
  put('context/decisions/adr-0001-ledger-is-append-only.md', DECISION);
  put('context/rules/rule-no-unbounded-retry.md', RULE);
  put('context/incidents/inc-2024-08-duplicate-charges.md', INCIDENT);
  put('context/deprecations/dep-legacy-fx-client.md', DEPRECATION);
  put('context/ownership/own-payments.md', OWNERSHIP);
  put('.github/workflows/context.yml', WORKFLOW);
  return written;
}
