# tier — risk-tiered autonomy computed from your own telemetry

Catalogue #20. Most organisations set one autonomy policy for all code, which is
simultaneously too slow for the trivial ninety percent and far too loose for the
dangerous one percent.

```sh
tier init
tier diff --base main --gate 1
tier score src/payments/charge.ts db/migrations/0004_shelf.sql
tier explain src/payments/charge.ts
tier policy
```

## Signals

| signal | source | notes |
| --- | --- | --- |
| blast radius | reverse dependency count from static imports | intra-repo, resolvable specifiers only; unresolved imports are reported, never guessed |
| incident history | commits whose subject matches `incidentPattern` | `fix`, `hotfix`, `revert`, `regress`, `incident`, `outage`, `bug`, `INC-1234` |
| coverage | `coverage/lcov.info` | absent or unlisted is reported as unknown, and treated as uncovered |
| reversibility | `irreversible` globs | migrations, SQL, terraform, workflows, charts, Dockerfiles |
| load-bearing core | `sensitive` globs | payments, billing, auth, session, crypto, idempotency, retry, ledger, migrations |

## Tiers

Risk is the weighted sum of the signals. Two floors are then applied, and printed
separately from the arithmetic so a reviewer can argue with them: anything sensitive
is at least tier 2, and sensitive plus irreversible is tier 3. Paths matching `exempt`
are not scored at all.

| tier | model | reviewers | auto-merge | other |
| --- | --- | --- | --- | --- |
| 0 | cheap | 0 | yes | well-covered leaf code |
| 1 | standard | 1 | no | ordinary code |
| 2 | strongest | 1 | no | oracle isolation: the test-writing agent must not see the implementation |
| 3 | strongest | 2 | no | dual key, and a human types |

Everything — weights, thresholds, globs and the policy table itself — lives in
`.keel/autonomy.json`, written by `tier init`. The defaults are a starting point for an
argument, not a recommendation.
