# Spec 003: One manifest semantic for every adapter

- Status: **Shipped in 0.2.0**
- Priority: P0
- Target release: 0.2.0
- Depends on: Spec 002
- Review finding: the two adapters disagree about what the manifest means. The
  Codex adapter renders only manifest-listed agents/rules; the Claude adapter
  copies entire source directories, ignoring the lists. In this repo the
  manifest declares 2 agents while `.claude/` contains 3 — the tool generates
  the exact cross-runtime drift it exists to prevent.

## Problem

`agents:` and `rules:` in `manifest.yaml` are either a selection mechanism or
they are decoration. Today they are both, depending on the runtime. A "single
source of truth" tool cannot have two interpretations of its source of truth.

## Design

**The manifest lists are the single, authoritative selection.** A source file
participates in compilation if and only if its name appears in the manifest.
Directory contents are inputs, not implicit configuration.

### Per-kind rules

- `agents:` — selects `.ai/agents/<name>.md`. Claude: one file each under
  `.claude/agents/`. Codex: one `## Agent:` section each.
- `rules:` — selects `.ai/rules/<name>.md`. Claude: inlined into `CLAUDE.md`
  (Spec 002). Codex: one `## Rule:` section each.
- `commands:` — NEW optional list, selects `.ai/commands/<name>.md`. Claude:
  one file each under `.claude/commands/` (real slash commands). Codex: skipped
  with an `info` diagnostic ("codex does not support repository commands"),
  never silently.
- Hooks: the blind `hooks/` directory copy is **removed**. Copying scripts into
  `.claude/hooks/` wires nothing (hooks live in settings) and implies support
  that does not exist. If `.ai/hooks/` is non-empty, `ai validate` and
  `ai sync` emit a warning pointing at Spec 009. No hook output is produced.

### Unlisted-file detection

A file present in a source directory but absent from the manifest is a
`warning` diagnostic:

```
warning: .ai/agents/staff-engineer.md exists but "staff-engineer" is not
listed in manifest agents. It will not be compiled.
```

This is a warning, not an error, so users can stage drafts — but it can never
again happen silently (this exact situation exists in this repository today).

## Requirements

1. The set of compiled agents/rules/commands MUST be identical across every
   enabled adapter for a given manifest. Property test: for random manifests,
   the section ids in `AGENTS.md` equal the file basenames under
   `.claude/agents/` plus the rule ids in `CLAUDE.md`.
2. Manifest order MUST be preserved in all rendered output (already true for
   Codex; becomes true for Claude file iteration and CLAUDE.md sections).
3. `manifest.files.hooks` and the hooks mapping MUST be removed from the
   adapter input contract until Spec 009 restores hooks with real semantics.
4. Unlisted source files MUST produce the warning above in both `validate` and
   `sync`.
5. The `commands` list follows the same normalization as `agents`/`rules`
   (dedupe, trim, non-empty strings, existence validation).

## Acceptance criteria

- With manifest agents `[a, b]` and a third file `c.md` on disk: `.claude/agents/`
  contains exactly `a.md` and `b.md`; `AGENTS.md` contains exactly agents a and
  b; the sync summary shows the unlisted-file warning for `c`.
- This repository's own manifest and sources are reconciled (Spec 007) and CI
  fails if the compiled sets ever diverge between runtimes.

## Out of scope

- Frontmatter metadata on source files (Spec 014 introduces it for Cursor).
- Glob or wildcard selection (`agents: ["*"]`). Explicit lists first; revisit
  only with user demand, because implicit selection is how the current bug
  happened.

## Migration

Users who relied on the Claude adapter's copy-everything behavior will see
files disappear from `.claude/agents/` after listing-enforcement, with the
warning explaining why. Release notes MUST include a one-line fix: add the
missing names to the manifest.
