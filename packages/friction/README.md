# friction — agent friction as a developer-experience metric

Catalogue #18. Where agents stall, retry and thrash in your repository, charged to the
module that caused it, so platform investment can be ranked by agent-minutes lost.

```sh
friction scan --since 30d           # this repo
friction scan --all-repos --json
friction events --module src/payments
friction sessions
```

## What is counted

| kind | definition |
| --- | --- |
| `tool-error` | a tool call that failed, and the time until the agent's next action |
| `repeat-command` | the second and later identical commands in one session |
| `edit-churn` | the third and later edit of one file in one session |
| `test-loop` | the third and later test run in one session, charged to the code just edited |

A call produces at most one event, highest-priority kind first, so minutes are never
counted twice. Durations are the gap to the agent's next action, capped at five
minutes (`--max-gap`), because an uncapped gap measures the human rather than the
agent. Calls that name no file are charged to `unknown` instead of being attributed by
guesswork, and `test-loop` never charges prose files.

A module is the first `--depth` segments of a path, which is the unit platform work
tends to be funded in.

## What it does not measure

Not developer productivity, not whether the agent was right, and not time a human
spent thinking. Session transcripts are read from `~/.claude/projects` and nothing is
sent anywhere.
