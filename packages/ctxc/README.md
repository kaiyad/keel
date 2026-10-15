# ctxc — a context compiler with its own CI

Catalogue #17. Compiles your decision records, incidents, deprecations, ownership and
rules into a versioned artifact for agents, then lints it like any other build input.

## Source format

```markdown
---
id: rule-no-unbounded-retry        # unique; retrieval telemetry and supersedes use it
kind: rule                         # decision | incident | deprecation | ownership | rule | taste
title: No unbounded retries against the payment processor
owner: payments-core               # required: context without an owner cannot be retired
status: active                     # active | draft | superseded
scope:
  - src/payments/**
expires: 2027-06-30                # optional; the only thing that evicts context
supersedes: rule-0004              # optional; id or list
incident: INC-2024-08              # optional; joins back to the postmortem
rule:                              # required when kind: rule
  subject: retry-policy
  directive: forbid                # require | forbid
  value: unbounded-retry
---

Prose for the agent and for the next maintainer.
```

## Configuration — `.keel/ctxc.json`

| key | default | meaning |
| --- | --- | --- |
| `sources` | `["context/**/*.md"]` | globs for context documents |
| `out` | `.keel/context` | where `context.json` and `context.md` are written |
| `codeRoots` | `["."]` | roots walked to validate scopes and compute coverage |
| `staleDays` | `90` | retrieval age that counts as stale |
| `expiringWithinDays` | `30` | how early an expiry warns |
| `retrievalLog` | `.keel/retrieval.jsonl` | append-only log written by `ctxc retrieved` |

## Diagnostic codes

Errors: `bad-frontmatter`, `missing-field`, `unknown-kind`, `unknown-status`,
`duplicate-id`, `dangling-supersedes`, `superseded-but-active`, `expired`,
`bad-date`, `missing-scope`, `rule-without-assertion`, `contradictory-rule`.

Warnings: `expiring-soon`, `unknown-scope`, `duplicate-rule`, `never-retrieved`,
`stale-retrieval`. Info: `no-retrieval-telemetry`.

CI pins on the codes, not the wording. `--strict` makes warnings fail too.

## Agent integration

`ctxc pack <paths>` prints only the context that applies to those paths, most binding
first. `--json` gives the ids, which an agent wrapper should feed back through
`ctxc retrieved` — that feedback is the only thing that can tell you which documents
nobody is reading.
