# Basic example

The smallest complete workspace: one rule, one agent, one command, compiled for
both supported runtimes.

Hand-maintaining this much is still easy, which is the point of starting here —
it shows the mechanism without arguing for it. See
[typescript-library](../typescript-library) for the case where the compiler
earns its place.

## Source

    .ai/
    ├── manifest.yaml           selects what compiles
    ├── rules/concise.md
    ├── agents/reviewer.md
    └── commands/summarize-diff.md

## Generated

    CLAUDE.md                          rules, inlined
    AGENTS.md                          rules and agents, inlined
    .claude/agents/reviewer.md
    .claude/commands/summarize-diff.md
    .ai/state/targets/*.json           which files the compiler owns

Both runtimes read their instructions from the repository root, so `CLAUDE.md`
and `AGENTS.md` are the files that actually get loaded. Codex has no repository
command format, so `summarize-diff` compiles for Claude only — reported as an
`info` diagnostic rather than dropped silently.

## Regenerate

    cd examples/basic
    node ../../bin/aie.mjs check    # is the committed output current?
    node ../../bin/aie.mjs sync     # regenerate it

The generated files are committed so the result can be inspected without running
the compiler, and CI fails if they drift from the source.
