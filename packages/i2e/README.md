# i2e — incident to eval

Catalogue #15. Every production incident becomes a permanent eval case: would the
current agent, with the current context, have written this bug?

## Importing

`i2e import <postmortem.md>` reads frontmatter (`id`, `incident`, `title`,
`category`, `scope`/`paths`, `assert`) and a `## Task` section. An incident document
written for `ctxc` is already a valid input.

```yaml
assert:
  - forbid_pattern=setTimeout\([^)]*charge
  - require_pattern=idempotency[_-]?key
  - require_path=src/payments/charge.ts
```

Import fails when a postmortem has no assertions, and prints the shape to add. A case
with nothing mechanical to check would pass forever and teach nothing. A prompt that
had to be synthesised is written with `needsReview: true` and listed as such.

## Running

```sh
i2e run --agent 'claude -p {{prompt}}' --gate regression
i2e run --replay captured/   # score <dir>/<case-id>.txt, no agent invoked
```

The prompt is substituted for `{{prompt}}` and also written to the command's stdin;
`{{paths}}` and `{{id}}` are available too. Each run is saved under `evals/runs/` with
the `ctxc` context version it was scored against, when one exists.

Exit codes: `--gate regression` (default) fails when a case that passed in the
previous run now fails; `--gate all` fails on any failure; `--gate none` never fails.

## Configuration — `.keel/i2e.json`

| key | default |
| --- | --- |
| `cases` | `evals/cases` |
| `runs` | `evals/runs` |
| `agent` | `""` — the command template |
| `timeoutMs` | `600000` |
| `outputLimit` | `20000` characters of agent output kept per case |
