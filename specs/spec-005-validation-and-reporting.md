# Spec 005: Validation that catches real failure, reporting that tells the truth

- Status: **Shipped in 0.2.0**
- Priority: P0
- Target release: 0.2.0
- Depends on: Spec 002, Spec 003
- Review finding: `ai validate` passes on a workspace that compiles to empty
  output (empty template, 0-byte sources — both present in this very repo).
  `ai sync` reports "Compiled claude: 2 file(s)" where the 2 counts directories
  and the true file count is zero.

## Problem

Validation and reporting exist to surface exactly the failures this project
itself shipped: hollow output that looks like success. Neither currently can.

## Design

### Diagnostic model

Extend the existing `DiagnosticError` usage into a collected-diagnostics pass:
`validate` and the pre-sync phase gather all diagnostics before failing, each
with `severity` (`error | warning | info`), `message`, optional `file`, and a
stable `code` (e.g. `template-missing-placeholder`). Errors abort; warnings
print and continue; `--strict` promotes warnings to errors (for CI).

### New validation checks

| Code | Severity | Condition |
| --- | --- | --- |
| `template-missing-placeholder` | error | A template lacks a placeholder whose corresponding manifest list is non-empty (e.g. `agents.md` without `{{RULES}}` while rules are listed) |
| `source-empty` | warning | A manifest-listed source file is empty or whitespace-only |
| `source-unlisted` | warning | Spec 003 unlisted-file detection |
| `hooks-unsupported` | warning | `.ai/hooks/` non-empty (until Spec 009) |
| `template-deprecated-name` | warning | `codex-agents.md` used instead of `agents.md` (Spec 002 migration) |
| `path-collision` | error | Two enabled adapters claim one path (Spec 002) |
| `output-collision` | error | Planned file collides with unowned existing file (Spec 001; sync-time) |

`ai validate` runs every phase except writes, including adapter `validate()`
when exported (per `docs/adapter-api.md`) and the staging render's planned-path
computation, so collisions are reported without touching the tree.

### Sync reporting

Human output — artifact-level, grouped by target, with actions:

```
claude
  created   CLAUDE.md
  created   .claude/agents/architect.md
  unchanged .claude/agents/security.md
codex
  created   AGENTS.md
  removed   .codex/AGENTS.md (stale)

2 warnings (run with --strict to fail on warnings)
```

Actions come from the Spec 002 render contract
(`created | updated | unchanged | removed`), determined by byte comparison
against pre-existing owned files.

Machine output — `ai sync --json` and `ai validate --json`:

```json
{
  "ok": true,
  "targets": [
    { "id": "claude",
      "artifacts": [ { "path": "CLAUDE.md", "action": "created" } ] }
  ],
  "diagnostics": [
    { "severity": "warning", "code": "source-unlisted",
      "message": "...", "file": ".ai/agents/staff-engineer.md" }
  ]
}
```

The JSON shape is a documented public contract (used by Spec 012's CI action).

### Exit codes

`0` success (warnings allowed) · `1` diagnostics error or collision ·
`1` also for warnings under `--strict`. Unknown command remains an error with
help pointer.

## Requirements

1. `ai validate` MUST fail on a workspace whose enabled targets would render
   zero rule content while rules are listed, and on missing placeholders.
2. The word "file" in CLI output MUST always refer to actual files.
3. All diagnostics for a run MUST be reported together, not first-failure-only,
   so a broken workspace is fixable in one iteration.
4. `--json` output MUST be stable across patch releases; changes to it are
   documented in the changelog.
5. Every diagnostic code MUST have at least one test asserting both trigger and
   non-trigger cases (Spec 006).

## Acceptance criteria

- Running `ai validate` against a copy of this repository's current (0.1.2)
  workspace fails with `source-empty` warnings under `--strict` and passes
  without it — proving the checks would have caught the hollow dogfood.
- A template missing `{{RULES}}` with one rule listed: validate exits 1 naming
  the template and the placeholder.
- `--json` round-trips through `JSON.parse` and matches the documented schema
  in a golden test.

## Out of scope

- `ai check` / `--dry-run` (Spec 012 builds directly on the `--json` plan).
- `ai explain` provenance output (Spec 010).
