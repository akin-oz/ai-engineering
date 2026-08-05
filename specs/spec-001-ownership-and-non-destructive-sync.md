# Spec 001: Artifact ownership and non-destructive sync

- Status: **Shipped in 0.2.0**
- Priority: P0 (blocks everything)
- Target release: 0.2.0
- Depends on: —
- Review finding: `ai sync` deletes pre-existing user files (verified: an existing
  `.claude/settings.json` was silently destroyed). `replaceDirectory` removes the
  entire output directory.

## Problem

Both adapters treat their output directory as disposable. The Claude adapter
calls `replaceDirectory`, which `rm -rf`s `.claude/` before renaming staging into
place. The Codex adapter calls `removeDirectory` on `.codex/`. Any user-owned
file inside those directories — `settings.json`, `settings.local.json`,
hand-written commands — is deleted without warning. The target audience is
people who already have a `.claude/` directory, so the first `ai sync` is
destructive for exactly the users the tool wants.

## Design

The compiler must only ever delete a file it can prove it created. Proof is an
ownership record written at the end of every successful sync.

### Ownership record

One JSON file per adapter at `.ai/state/targets/<adapter-id>.json`, committed to
the repository:

```json
{
  "version": 1,
  "adapter": "claude",
  "generator": "@akinlabs/ai-engineering@0.2.0",
  "paths": [
    ".claude/agents/architect.md",
    "CLAUDE.md"
  ]
}
```

- `paths` are file paths (never directories), relative to the project root,
  POSIX separators, sorted lexicographically.
- The record is compiler state, not configuration. Users never edit it.
- Committing it makes stale-cleanup work correctly on fresh clones and keeps
  `ai sync && git diff --exit-code` meaningful in CI.

### Sync algorithm (normative)

For each enabled adapter:

1. Load the previous ownership record. Missing record → empty owned set.
2. Render the adapter's complete output into a staging directory under the
   project root (`.ai/state/staging/<adapter-id>.<uuid>/`).
3. Compute the planned path set from staging.
4. **Collision check, before any mutation of the real tree.** For every planned
   path that already exists on disk and is NOT in the owned set:
   - if the existing bytes equal the planned bytes, adopt it silently (add to
     owned set, count as `unchanged`);
   - otherwise record a collision.
   If any collisions exist, abort the entire sync with a diagnostic listing
   every colliding path and the remediation (`--force` to overwrite and take
   ownership, or move the files aside). No file may have been written yet.
5. With `--force`, collisions are overwritten and become owned.
6. Move planned files into place file-by-file (staged write + rename per file,
   creating parent directories as needed).
7. Delete every previously-owned path that is not in the planned set. After
   deleting, prune ancestor directories that are now empty, stopping at the
   project root, and never removing a directory that still contains anything.
8. Write the new ownership record atomically. Remove the staging directory.

### Failure behavior

If any step before 6 fails, the working tree is untouched. If a failure occurs
during 6–8, the previous ownership record must not be replaced by a partial
one; the next sync recovers by re-rendering (writes are idempotent). Staging
directories are always removed in a `finally` block.

## Requirements

1. `ai sync` MUST never delete or overwrite a file absent from the adapter's
   ownership record, except under `--force` after an explicit collision listing.
2. Files not written by the compiler MUST survive any number of syncs
   byte-for-byte, including files inside managed directories
   (`.claude/settings.json` is the canonical test case).
3. Stale generated files (owned previously, not planned now) MUST be removed.
4. The collision diagnostic MUST name every colliding path in one message, not
   fail one path at a time.
5. `.ai/state/` MUST be excluded from every adapter's input scanning.
6. The `replaceDirectory` whole-directory deletion helper MUST be removed from
   the adapter-facing API surface.

## CLI changes

- `ai sync --force` — overwrite listed collisions and take ownership.
- Sync summary gains a `removed N stale file(s)` line when cleanup occurred
  (exact reporting format is Spec 005).

## Acceptance criteria

- In a repo with a pre-existing `.claude/settings.json` and hand-written
  `.claude/commands/mine.md`: `ai sync` succeeds and both files are untouched.
- In a repo with a pre-existing `CLAUDE.md` differing from generated output:
  `ai sync` exits non-zero, lists `CLAUDE.md`, writes nothing;
  `ai sync --force` succeeds and subsequent syncs treat it as owned.
- Removing a rule from the manifest then syncing removes its generated file and
  its entry from the ownership record; empty directories are pruned.
- Killing the process mid-render leaves the previous installation intact.

## Out of scope

- JSON-key-level ownership inside shared files such as `settings.json`
  (Spec 009).
- Cross-adapter path-collision detection (Spec 002, ownership table).

## Migration

Existing users have no ownership records, so their previously generated files
appear as collisions on first 0.2 sync. Because generated files carry no banner
in the Claude tree, exact-byte adoption (step 4) resolves the common case where
outputs are unchanged. The 0.2.0 release notes MUST document the one-time
`--force` that may be needed otherwise.
