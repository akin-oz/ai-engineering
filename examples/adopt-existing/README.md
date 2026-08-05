# Adopting an existing repository

This example is frozen in the "before" state — the state most real repositories
are actually in. It has a hand-written `CLAUDE.md`, an `AGENTS.md` that has
quietly drifted from it, a Claude subagent, and a Cursor rule.

Nothing here was generated. That is the point.

## The drift is already there

Compare the two testing policies:

`CLAUDE.md`

> Every pull request runs the full test suite before it can merge. Bug fixes
> start with a failing test that reproduces the report, written before the fix.

`AGENTS.md`

> Every pull request runs the full test suite before merging. Bug fixes should
> have a test that reproduces the report.

One requires the test to be written first and to fail; the other suggests a test
should exist. Claude Code and Codex are being told different things, nothing is
broken, no build fails, and nobody has noticed. The release policy and the
preamble, meanwhile, are duplicated word for word — three copies of the same
paragraph to keep in step by hand.

## Walk through it

From this directory:

    node ../../bin/aie.mjs adopt

Adopt is a dry run by default. It prints exactly what it would create, which
manifest entries it would add, and which pairs look like the same policy written
twice. Nothing is written, and your original files are never modified in any
mode.

    node ../../bin/aie.mjs adopt --write

Now `.ai/` contains one file per section, each stamped with `adopted-from:` so
you can trace it back. The identical preamble and release policy are flagged as
duplicates for you to merge. **The drifted testing policies are not flagged** —
they are genuinely different text, so the tool imports both and leaves the
decision to you. Seeing them side by side in one directory is the first time the
disagreement is visible at all.

Merge what should be merged, delete what is obsolete, then:

    node ../../bin/aie.mjs sync

This reports your original `CLAUDE.md`, `AGENTS.md`, and `.claude/agents/` as
collisions rather than overwriting them, because the compiler did not create
them. Read the diff, and when the generated output is what you want:

    node ../../bin/aie.mjs sync --force

From here the drift cannot come back silently: `aie check` fails in CI whenever
a generated file stops matching its source.

## Why this directory has no .ai/

So the walkthrough starts where you start. Run adopt, and it appears.
