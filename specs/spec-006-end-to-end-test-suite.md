# Spec 006: End-to-end tests on the real user path

- Status: **Shipped in 0.2.0**
- Priority: P0
- Target release: 0.2.0
- Depends on: Spec 001–005 (tests land with each, this spec defines the harness)
- Review finding: the existing tests hand-construct manifest objects and test
  adapters in isolation. None runs `init → sync` as a user does, so none could
  catch the empty golden path, the wrong `AGENTS.md` location, or the deletion
  of `.claude/settings.json`. Worse, the destructive behavior is asserted as
  *desired* in `test/adapters.test.mjs` ("removes stale output" deletes an
  unowned file).

## Problem

Unit tests verified the implementation while the product was broken. The
missing layer is a suite that exercises the CLI binary against a temporary
directory exactly as a user would, asserting on the resulting tree.

## Design

### Harness

Extend `test/helpers.mjs` with:

```js
const repo = await makeTempRepo();          // mkdtemp + cleanup
const result = await runCli(repo, ["sync"]); // spawns node bin/ai.mjs, cwd=repo
// result: { code, stdout, stderr }
await repo.tree();                           // sorted relative file list
await repo.read("CLAUDE.md");
```

Spawning the real binary (not importing `run()`) is deliberate: it covers the
JSON import attribute, the exit-code path, and stdout formatting. Keep one
smoke case through the *packed* tarball in CI (already exists) — the e2e suite
itself runs from source for speed.

### Required scenarios

Golden path

1. `init` in empty dir → exact expected tree; `init` again → no changes,
   "already exists" output.
2. `init` → `sync` → root `CLAUDE.md` and `AGENTS.md` exist, contain the seeded
   rule text; ownership records exist and list every generated file.
3. Second `sync` → all artifacts `unchanged`, tree byte-identical (hash the
   whole tree before/after).

Safety (regression tests for the review's findings — each cites its spec)

4. Pre-existing `.claude/settings.json` and `.claude/commands/mine.md` survive
   `sync` byte-for-byte. (Spec 001)
5. Pre-existing divergent `CLAUDE.md` → `sync` exits 1, tree untouched, all
   collisions listed; `sync --force` succeeds; next `sync` treats it as owned.
   (Spec 001)
6. Pre-existing `CLAUDE.md` byte-identical to planned output → adopted
   silently. (Spec 001)
7. Rule removed from manifest → its artifacts removed, unrelated files intact,
   empty dirs pruned. (Spec 001)
8. Legacy `.codex/AGENTS.md` with banner → migrated away; without banner →
   preserved and reported. (Spec 002)

Consistency

9. Property-style test: for a set of generated manifests (0–4 agents, 0–4
   rules, extra unlisted files), the compiled agent/rule id sets are identical
   across both runtimes' outputs. (Spec 003)
10. Empty agents list → `AGENTS.md` has no `## Agent:` heading, no dangling
    separator. (Spec 002)

Diagnostics

11. One failing case and one passing case per diagnostic code in Spec 005's
    table, asserting code, severity, exit code, and `--strict` promotion.
12. `--json` golden test against the documented schema.

### Adapter unit tests

Keep them, but rewrite the two stale-output assertions to the ownership
semantics: stale *owned* files are removed; unowned files are preserved. The
current `stale.txt` deletion assertions are inverted by Spec 001 and must flip.

### CI wiring

- e2e job runs on the same Node matrix as unit tests.
- The existing `ai sync && git diff --exit-code` self-check stays.
- Add: compile every directory under `examples/` and `git diff --exit-code`
  (Spec 008).
- Add the dogfood content guard (Spec 007).

## Requirements

1. Every P0 spec's acceptance criteria MUST exist as e2e cases in this suite
   before that spec is marked shipped.
2. e2e tests MUST assert on file contents and exit codes, not on log strings
   alone (formatting may change; behavior may not).
3. The suite MUST run in under ~30s locally so it stays in the default
   `npm test`, not a separate opt-in script.
4. No test may write outside its temp directory.

## Acceptance criteria

- Reverting any single one of: the ownership check (Spec 001), the root-file
  paths (Spec 002), Claude list-selection (Spec 003), or the seeded template
  (Spec 004), causes at least one named test to fail. Verify by mutation once,
  manually, before release.

## Out of scope

- Testing against the real Claude Code / Codex binaries (no hermetic way to do
  it; the contract tested is file location + content).
- Windows CI (worth adding later; path handling uses `node:path` throughout,
  but ownership records store POSIX paths — one normalization test now, full
  matrix later).
