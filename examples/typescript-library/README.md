# TypeScript library example

A published library maintained by a small team using Claude Code, Codex, and
Cursor.

This is where hand-maintenance actually fails. Four rules, two agents, and two
commands become **twelve generated files across three runtimes**. Keeping them
aligned by hand works until the day someone tightens the release policy in one
file and not the others, and nobody notices because nothing breaks loudly. The
assistants just start giving different advice depending on which one you opened.

## Try the payoff

Change one line in `.ai/rules/releases.md` — say, require a migration note for
every major release:

    node ../../bin/aie.mjs check    # both root files are now out of date
    node ../../bin/aie.mjs sync     # one edit, every runtime updated
    git diff

The same edit lands in `CLAUDE.md` and `AGENTS.md`, and `aie check` would have
failed CI if you had forgotten to run it.

## Source

    .ai/
    ├── manifest.yaml
    ├── rules/          code-style, testing, releases, documentation
    ├── agents/         reviewer, release-manager
    └── commands/       changeset, review-pr

## Generated

    CLAUDE.md                     four rules, inlined
    AGENTS.md                     four rules and two agents, inlined
    .claude/agents/*.md           two agent definitions
    .claude/commands/*.md         two slash commands
    .cursor/rules/*.mdc           four rules, one file each

Each runtime gets the shape it can actually use. `code-style.md` declares
`scope: src/**/*.ts` in its frontmatter, so Cursor receives it as a globbed rule
that only applies to source files, while Claude and Codex inline it — they have
no way to express path scoping, so the metadata is carried but not enforced.

Codex and Cursor have no repository command format, so `changeset` and
`review-pr` compile for Claude only. The compiler reports this as an `info`
diagnostic on every run rather than dropping them silently — knowing what a
runtime cannot express is part of what the tool is for.
