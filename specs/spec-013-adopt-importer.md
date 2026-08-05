# Spec 013: `aie adopt` — import existing assistant files

- Status: **Shipped in 0.2.0**
- Priority: P2
- Target release: 0.3.x
- Depends on: Spec 001, Spec 004, Spec 005
- Review finding: every realistic prospect already has a `CLAUDE.md`, an
  `AGENTS.md`, or a `.cursor/rules/` directory — often several, already
  drifted. The tool currently starts from zero and treats their existing files
  as collisions. No tool in the rules-sync cluster does the reverse direction
  well; a good importer converts the largest objection ("I have files already")
  into the on-ramp.

## Problem

Adoption today means hand-splitting existing instruction files into `.ai/`
sources. That is exactly the kind of mechanical, error-prone work a compiler
project should automate — and the first-run collision experience (Spec 001)
actively needs this escape hatch to point at.

## Design

### Sources scanned

| Path | Interpretation |
| --- | --- |
| `CLAUDE.md` | root instructions |
| `AGENTS.md` | root instructions |
| `.claude/agents/*.md` | agents (frontmatter preserved) |
| `.claude/commands/*.md` | commands |
| `.cursor/rules/*` , `.cursorrules` | rules (frontmatter recorded as metadata) |
| `.github/copilot-instructions.md` | root instructions |

Files bearing this tool's own generated banner are skipped (already compiled
output, not source).

### Splitting model (deliberately conservative)

- Root instruction files: split at `##`-level headings into one rule per
  section, slugified from the heading (`## Testing policy` →
  `rules/testing-policy.md`). Content before the first heading becomes
  `rules/<filename>-preamble.md`. **No semantic interpretation, no rewriting,
  no LLM calls** — adopt is deterministic and dumb by design; the user curates
  afterwards.
- Agent/command files: copied one-to-one.
- Every adopted file gets a provenance frontmatter line the compiler ignores:
  `adopted-from: CLAUDE.md` (plus source heading when split).

### Duplicate content across sources

When two sources yield near-identical sections (the drifted-copies case), adopt
does NOT merge them. Both files are written
(`testing-policy.md`, `testing-policy-2.md`), and the report flags the pair as
probable duplicates with a similarity note. Merging is a human judgment; the
tool's job is to make the drift visible in one directory for the first time.

### Modes

- Default: **dry run.** Prints the full plan — every source file, every target
  file, the manifest that would be written, duplicate flags — and writes
  nothing.
- `aie adopt --write`: performs the plan. Creates/updates `.ai/` sources and
  manifest lists (appending to an existing manifest, never reordering existing
  entries). **Original files are never modified or deleted.**
- After `--write`, the closing output states the follow-up explicitly: review
  `.ai/`, run `aie sync`, resolve the reported collisions between originals
  and newly generated files (`--force` once originals are verified), then
  delete nothing until sync output is trusted.

### Idempotency

Re-running adopt skips any source whose content already exists verbatim in an
`adopted-from`-marked file, reporting `already adopted`. Changed originals are
re-imported under a `-2` suffix with a note, never overwriting a possibly
hand-edited adopted file.

## Requirements

1. Adopt MUST never modify or delete any scanned source file, in any mode.
2. Dry run MUST be the default; `--write` is the only writing path.
3. Output MUST be deterministic for a given tree (stable slugs, stable
   ordering, stable suffixing).
4. Adopted workspaces MUST pass `aie validate` (not necessarily `--strict`:
   duplicate-pair warnings are expected and acceptable).
5. The splitting heuristics are limited to heading structure; no content
   transformation beyond trimming.

## Acceptance criteria

- e2e on the `examples/adopt-existing` fixture (Spec 008): dry run matches a
  golden plan; `--write` then `validate` passes; `sync` reports the original
  root files as collisions with adopt-aware remediation text; the fixture's
  deliberately drifted section pair is flagged as duplicates.
- Adopt on a repo with only this tool's generated output: "nothing to adopt".
- Adopt twice: second run reports all-already-adopted, writes nothing.

## Out of scope

- LLM-assisted semantic merge/dedup of drifted copies (possible future,
  explicitly out — it breaks determinism, the project's core promise).
- Importing hooks or settings (no reliable source mapping until Spec 009 has
  settled the hook model).
- Windsurf/Zed/Aider source formats — add per demand, each with a fixture.
