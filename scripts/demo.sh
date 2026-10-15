#!/usr/bin/env bash
# One pass through all four tools on a throwaway repo, so you can see the
# pipeline work before pointing it at anything real. Usage: scripts/demo.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
ctxc="node $here/packages/ctxc/dist/cli.js"
i2e="node $here/packages/i2e/dist/cli.js"
tier="node $here/packages/tier/dist/cli.js"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

mkdir -p "$work/src/payments" "$work/db/migrations"
echo 'export const charge = () => {};' > "$work/src/payments/charge.ts"
echo 'alter table ledger add column note text;' > "$work/db/migrations/0001_note.sql"
git -C "$work" init -q
git -C "$work" add -A
git -C "$work" -c user.email=demo@example.com -c user.name=demo commit -qm 'initial'

step "ctxc: compile the context an agent will be given"
$ctxc init --root "$work" >/dev/null
$ctxc build --root "$work"

step "ctxc: what an agent gets when it touches the payment path"
$ctxc pack src/payments/charge.ts --root "$work" | head -20

step "ctxc: a second rule that contradicts the first fails the build"
cat > "$work/context/rules/rule-retry-ok.md" <<'RULE'
---
id: rule-retry-is-fine
kind: rule
title: Unbounded retry is acceptable in payments
owner: platform
status: active
scope:
  - src/payments/**
rule:
  subject: retry-policy
  directive: require
  value: unbounded-retry
---

Added in a hurry, contradicting the rule written after the incident.
RULE
$ctxc build --root "$work" || echo "(exit 1, as it should)"
rm "$work/context/rules/rule-retry-ok.md"

step "i2e: the incident record becomes a permanent eval case"
cat >> "$work/context/incidents/inc-2024-08-duplicate-charges.md" <<'TASK'

## Task

Add a retry to the charge call so transient processor timeouts do not fail the payment.
TASK
$i2e import context/incidents/inc-2024-08-duplicate-charges.md --root "$work" \
  --assert 'require_pattern=idempotency[_-]?key' \
  --assert 'forbid_pattern=while \(true\)' \
  --category idempotency

printf '#!/bin/sh\ncat > /dev/null\necho "bounded retry budget with an idempotency_key"\n' > "$work/good-agent.sh"
printf '#!/bin/sh\ncat > /dev/null\necho "retrying in a while (true) loop, no key"\n' > "$work/bad-agent.sh"
chmod +x "$work/good-agent.sh" "$work/bad-agent.sh"

step "i2e: a good agent passes the case"
$i2e run --root "$work" --agent ./good-agent.sh --label good --gate regression

step "i2e: a weaker agent regresses it, and CI stops"
$i2e run --root "$work" --agent ./bad-agent.sh --label candidate --gate regression || echo "(exit 1, as it should)"

step "tier: the autonomy this change is allowed"
$tier score src/payments/charge.ts db/migrations/0001_note.sql --root "$work"

step "tier: the arithmetic behind one file"
$tier explain db/migrations/0001_note.sql --root "$work"

step "friction: where agents actually lose time in this repo"
echo "(reads ~/.claude/projects; run: friction scan --all-repos --since 30d)"

printf '\nDemo repo left at %s\n' "$work"
