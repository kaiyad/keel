# @keel/core

Shared internals for the four CLIs: a minimal frontmatter parser, path globs with an
overlap test, a repo walker, git helpers that capture their own stderr, terminal
tables and the `Diagnostic` shape the tools report in.

The frontmatter parser deliberately supports one small YAML subset — scalars, lists,
one level of nesting, inline `[a, b]` — and reports anything outside it as a problem
rather than reinterpreting it. Context that parses differently from how its author
read it is worse than context that fails the build.

`scopesOverlap(a, b)` decides whether two globs can match the same file without
touching the filesystem, by matching each against a representative literal of the
other. It is what makes `ctxc`'s contradiction check mechanical.
