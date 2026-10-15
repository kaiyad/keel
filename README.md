# keel

Twenty-eight engineering practices for teams where most code is written by a model,
and working first versions of the four that change the delivery pipeline most.

The catalogue is the full set of proposals, held as data in
[`catalog/catalog.json`](catalog/catalog.json) so the tools and the docs cannot drift
apart. Four of them are built, tested and runnable today. The rest are specified, not
implemented, and say so.

Everything here is local, zero-dependency Node and reads data you already have: git
history, lcov reports, postmortems, decision records and Claude Code session
transcripts. No service, no account, no API key — the only tool that talks to a model
is `i2e`, and it does so by shelling out to whatever agent command you give it.

## The four that are built

Chosen from the fifteen pipeline items on three tests: it changes the delivery system
rather than an individual's habits, it is the highest-leverage item in its part of
the pipeline, and a first version can run on real data on a laptop today rather than
waiting for a platform team.

| tool | catalogue # | what it does | the number it produces |
| --- | --- | --- | --- |
| [`ctxc`](packages/ctxc) | 17 | compiles decision records, incidents, deprecations, ownership and rules into a versioned context artifact for agents, then lints it | context version, contradictions, stale rules, % of code in scope of a rule |
| [`i2e`](packages/i2e) | 15 | turns every postmortem into a permanent eval case and gates model, prompt and rule changes on it | pass rate per incident category, and regressions against the last run |
| [`friction`](packages/friction) | 18 | reads agent session transcripts and charges stalls, retries and thrash to the module that caused them | agent-minutes lost per module |
| [`tier`](packages/tier) | 20 | derives the autonomy a change is allowed from blast radius, incident history, coverage and reversibility | a tier 0–3 per file, and the policy it requires |

They compose into one loop, which is the actual point:

```
postmortems ─┐
             ├─► ctxc build ──► versioned context ──► the agent
decisions  ──┤                        │
rules ───────┘                        └─► i2e run (pinned to that context version)
                                                 │
tier diff ──► how much autonomy this change gets  │ regressions block the merge
friction scan ──► which module to fix next ───────┘
```

`i2e` records the `ctxc` context version each run was scored against, so "the eval
went down" can be traced to a context change rather than argued about. `tier` reads
the same incident history that `i2e` imports from.

## Quick start

```sh
npm install
npm run build
npm run link-all     # puts ctxc, i2e, friction and tier on your PATH
scripts/demo.sh      # all four, end to end, on a throwaway repo
```

Requires Node 22.6 or newer (the test runner executes TypeScript directly). There are
no runtime dependencies.

### ctxc — a context compiler with its own CI

```sh
ctxc init                         # scaffold context/, config and a CI workflow
ctxc build --strict               # compile to .keel/context/, fail on contradictions
ctxc pack src/payments/charge.ts  # exactly the context that applies to this change
ctxc retrieved rule-no-unbounded-retry --agent claude-code
ctxc stats
```

Sources are markdown with frontmatter: `id`, `kind`
(`decision|incident|deprecation|rule|ownership|taste`), `title`, `owner`, `scope`
globs, optional `expires` and `supersedes`, and for rules a machine-checkable
`rule: {subject, directive, value}`.

The build fails on contradictory rules over overlapping scopes, a document superseded
but still active, a dangling `supersedes`, expiry in the past, a rule with nothing
mechanical to check, and an unscoped rule. It warns on scopes that match no file, a
document no agent has ever retrieved, and one not retrieved in ninety days. The
compiled version is a content hash, so an unchanged corpus compiles to the same
version and an agent run can be pinned to it.

### i2e — incident-to-eval

```sh
i2e import postmortems/INC-2024-08.md --assert 'require_pattern=idempotency[_-]?key'
i2e run --agent 'claude -p {{prompt}}' --gate regression
i2e report --out evals/report.md
```

A case is the task as it was handed over before the incident, plus assertions that
can be checked without a human: `require_pattern`, `forbid_pattern`, `require_path`,
`forbid_path`. Import **refuses** a postmortem with no assertions rather than creating
a case that scores 100% forever, and flags a prompt it had to synthesise. `--replay`
scores pre-captured agent output, so the harness is testable and CI can re-score
without re-running an agent. A case that used to pass and now fails exits 1.

### friction — agent friction as a DX metric

```sh
friction scan --since 30d            # this repo, ranked by agent-minutes lost
friction scan --all-repos --markdown
friction events --module src/payments
```

Reads `~/.claude/projects/**/*.jsonl`, reconstructs tool calls and charges four kinds
of lost time to the module that caused it: a failing tool call, the second and later
identical commands in a session, the third and later edit of one file, and the third
and later test run (charged to the code just edited, never to prose files). Durations
are capped at five minutes so an idle terminal is not reported as agent time, and a
call never produces two events, so minutes are not double-counted. Commands that name
no file are charged to `unknown` rather than guessed at.

### tier — risk-tiered autonomy from your own telemetry

```sh
tier init
tier diff --base main --gate 1   # exit 1 when a change needs more than tier 1
tier explain src/payments/charge.ts
tier policy
```

Four observable signals — reverse-dependency count, commits whose subject looks like
a fix or revert, lcov line coverage, and whether the path's effects survive a revert —
are weighted into a risk score, then two floors are applied and stated separately from
the arithmetic: anything in the configured load-bearing core is never below tier 2,
and load-bearing plus irreversible is tier 3. `tier explain` prints the whole
calculation, because a governance number nobody can argue with is a number nobody
will believe. Documentation paths are exempt rather than scored, and missing coverage
is reported as unknown rather than silently treated as fine.

## Verification

Run on 2026-10-16, Node v24.18.0, macOS:

```
npm run build       ✓ all five packages compile
npm run typecheck   ✓ strict, noUncheckedIndexedAccess
npm test            ✓ 40 tests pass (core 5, ctxc 9, i2e 10, friction 6, tier 10)
```

`friction` was additionally run against 1,918 real tool calls across 32 sessions, and
`tier` against two real repositories; `ctxc` and `i2e` were run end to end through
`scripts/demo.sh`, including the failure paths that exit 1.

## The full catalogue

Twenty-eight proposals: thirteen on keeping human cognition load-bearing, fifteen on
the delivery pipeline. `spec` means specified here and not implemented.

<!-- catalog:start -->

| # | product | part | cost | status |
| --- | --- | --- | --- | --- |
| 1 | Comprehension debt ledger | cognition | med | spec |
| 2 | Prediction-first review | cognition | low | spec |
| 3 | Trust-calibration scoreboards | cognition | low | spec |
| 4 | Cold rebuild drills | cognition | low | spec |
| 5 | A manual load-bearing core | cognition | low | spec |
| 6 | Bug-injection gym on your own repo | cognition | med | spec |
| 7 | The reverse rubber duck | cognition | low | spec |
| 8 | Invert the junior and the model | cognition | low | spec |
| 9 | A deliberate-difficulty budget | cognition | low | spec |
| 10 | Code club | cognition | low | spec |
| 11 | A house taste corpus | cognition | med | spec |
| 12 | Hire and promote on diagnosis, not authoring | cognition | med | spec |
| 13 | Mandatory "why not the alternative" | cognition | low | spec |
| 14 | Regeneration as a spec-tightness metric | pipeline | high | spec |
| 15 | Incident-to-eval pipeline | pipeline | med | **built** `i2e` |
| 16 | Canary the coding agent like a production dependency | pipeline | med | spec |
| 17 | A context compiler with its own CI | pipeline | high | **built** `ctxc` |
| 18 | Agent friction as a developer-experience metric | pipeline | low | **built** `friction` |
| 19 | Swarm and select for migrations | pipeline | med | spec |
| 20 | Risk-tiered autonomy computed from your own telemetry | pipeline | high | **built** `tier` |
| 21 | Oracle isolation | pipeline | med | spec |
| 22 | A pre-mortem agent in design review | pipeline | med | spec |
| 23 | Spec excavation before legacy rewrites | pipeline | high | next |
| 24 | An entropy agent with a deletion target | pipeline | med | spec |
| 25 | Behaviour diff, and planning against review capacity | pipeline | med | spec |
| 26 | An eval-gated internal skill marketplace | pipeline | high | spec |
| 27 | Continuous audit evidence | pipeline | high | spec |
| 28 | Counterfactual postmortems | pipeline | med | spec |

<!-- catalog:end -->

Regenerate this table after editing the catalogue with `npm run catalog`.

### What is deliberately not built yet

**#23 spec excavation before legacy rewrites** is the item with the strongest budget
case, and it is not here. A first version needs recorded production traffic to
characterise the old service against, which is an environment question rather than a
code question, and an inferred specification is the one output in this repo that
cannot be produced deterministically. It is the next build, and it reuses `i2e`'s
assertion model for the characterisation suite.

Of the rest, the ones that follow most cheaply from what exists: **#16 canary the
coding agent** is `i2e run` over last month's merged pull requests; **#28
counterfactual postmortems** is `i2e` plus `ctxc pack` at the incident's commit;
**#22 pre-mortem agent** is `ctxc`'s incident corpus as a design reviewer. The
thirteen cognition practices are rituals and policies, not software, and adding a tool
to any of them would be the wrong move.

## Caveat, carried over from the source

**These are proposals, not measured results.** There is no evidence that any of them
work at scale, and several would be actively harmful if imposed as mandatory process
on a team that did not choose them. Pilot one at a time, on one team, for one quarter,
with the success metric written down before you start — otherwise you will not be able
to tell the practice from the enthusiasm of the people who volunteered for it.

The tools make the claims checkable. They do not make them true.
