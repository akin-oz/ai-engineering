# Spec 004: A first run that produces something

- Status: **Shipped in 0.2.0**
- Priority: P0
- Target release: 0.2.0
- Depends on: Spec 002, Spec 003
- Review finding: verified clean-room run of `ai init && ai sync` produces empty
  directories and a banner-only `AGENTS.md`. `init` seeds an empty Codex
  template with no placeholders, so Codex output stays empty forever — even
  after the user adds rules — unless they discover undocumented placeholder
  syntax. The CLI then reports "Compiled claude: 2 file(s)" for zero files.

## Problem

The golden path is the product's one chance with each evaluator. Today it
produces nothing, reports success, and contains a trap (the placeholder-less
template) that keeps producing nothing indefinitely.

## Design

### What `ai init` writes

```
.ai/
├── manifest.yaml            # version: 1, both targets, seeded rule listed
├── agents/                  # empty, with guidance in next-steps output
├── rules/
│   └── project.md           # seeded starter rule with real content
├── commands/                # empty
└── templates/
    ├── claude.md            # seeded, contains {{RULES}} placeholder
    └── agents.md            # seeded, contains {{RULES}} and {{AGENTS}}
```

Seeded `manifest.yaml`:

```yaml
version: 1

targets:
  claude:
    enabled: true
  codex:
    enabled: true

agents: []

rules:
  - project

commands: []
```

Note: init currently writes `schema: 1` while docs and examples use
`version: 1`. Standardize on `version:` everywhere (the loader keeps accepting
both).

Seeded `rules/project.md` (starter content, meant to be edited, never empty):

```markdown
Describe how an AI assistant should work in this repository.
Replace this text with your first real rule — for example:

Prefer small, reviewable changes. Explain trade-offs when several
reasonable approaches exist. Never commit generated files by hand.
```

Seeded templates contain the placeholders plus a one-line comment explaining
them, so a user opening the file understands the mechanism without reading
docs.

### What the first `ai sync` produces

Immediately after init, with zero user edits:

- root `CLAUDE.md` containing the seeded rule;
- root `AGENTS.md` containing the seeded rule;
- ownership records for both targets.

The seeded rule's self-describing text doubles as the instruction to customize,
visible inside the assistant itself.

### `init` output

The next-steps text must be accurate for the new flow and mention the compiled
root files by name, so users know what to look for:

```
Next steps:

1. Edit .ai/rules/project.md (it is loaded by every assistant)
2. Add more rules and agents under .ai/, list them in .ai/manifest.yaml
3. Run: ai sync
   → generates CLAUDE.md, AGENTS.md, .claude/
```

### Init in a repo with existing assistant files

If a root `CLAUDE.md` or `AGENTS.md` already exists, init MUST print a notice
that `ai sync` will report them as collisions and that `ai adopt` (Spec 013)
can import them. Init itself stays non-destructive and idempotent.

## Requirements

1. `ai init && ai sync` in an empty directory MUST yield a `CLAUDE.md` and
   `AGENTS.md` whose rendered rule content is non-empty. This is a CI-enforced
   end-to-end test (Spec 006), not a convention.
2. Every file init seeds MUST be syntactically complete: templates contain
   their placeholders; the manifest lists what the seeds provide.
3. Init MUST remain idempotent and never overwrite an existing file.
4. Sync reporting MUST name artifacts, never count directories as files
   (detailed format in Spec 005).

## Acceptance criteria

- Clean-room e2e: init → sync → both root files exist, contain "Prefer small,
  reviewable changes" (or the final seeded text), second sync is byte-stable.
- init → user deletes seeded rule file → `ai validate` fails with the missing-
  source diagnostic naming `rules/project.md` (existing behavior, retained).
- init in a repo that already has `.ai/` prints "already exists" and changes
  nothing (existing behavior, retained).

## Out of scope

- Interactive wizard / blueprint init (Spec 010 and the workflow-compiler RFC).
- `--targets` selection flags. Both targets on is a fine default until a third
  adapter exists (Spec 014 adds the flag).
