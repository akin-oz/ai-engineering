# Spec 012: `aie check`, `--dry-run`, and a GitHub Action

- Status: **Shipped in 0.2.0**
- Priority: P2
- Target release: 0.2.x (check/dry-run), 0.3.x (action)
- Depends on: Spec 001 (planned-path computation), Spec 005 (`--json`, actions)
- Review finding: the CI drift check currently requires users to hand-compose
  `aie sync && git diff --exit-code` — which *writes to the tree* to detect
  drift and cannot distinguish drift from collisions. Drift detection is also
  the tool's best standalone wedge: useful to teams that haven't adopted
  compilation, and discoverable via the Actions marketplace in a way npm
  packages are not.

## Problem

Detecting drift should not require mutating the working tree, and the CI
integration should be one YAML block, not a shell recipe.

## Design

### `aie check`

Runs the full pipeline through staging and planned-path computation (Spec 001
steps 1–4), compares planned bytes against the working tree, **writes
nothing**, and reports per-artifact status using Spec 005's vocabulary:

```
claude
  drift     CLAUDE.md            (would update)
  ok        .claude/agents/architect.md
codex
  missing   AGENTS.md            (would create)
  stale     .codex/AGENTS.md     (would remove)

3 artifacts out of date. Run: aie sync
```

Exit codes: `0` clean · `1` drift (missing/outdated/stale artifacts) ·
`2` diagnostics error (invalid workspace, collisions). The 1/2 split lets CI
distinguish "run sync" from "fix your workspace". `--json` emits the Spec 005
shape with a `wouldChange` list.

Collisions (unowned existing file differs from planned) are reported under
exit 2 with the same remediation text as sync — check must never advise a sync
that would then fail.

### `aie sync --dry-run`

Alias of `check` with sync-flavored wording ("would create/update/remove").
One implementation, two entry points; `--dry-run --force` previews collision
overwrites.

### GitHub Action

Composite action in this repo (`action.yml` at root) so `uses:` works
directly against the repository:

```yaml
- uses: akin-oz/ai-engineering@v0
  with:
    strict: true        # default: true — warnings fail the job
```

Behavior: setup-node if needed, install the pinned package version matching
the action tag, run `aie check --json --strict`, convert each drifted artifact
and diagnostic into a workflow annotation
(`::error file=CLAUDE.md::out of date — run aie sync`), and write a job
summary table from the JSON. Version the action tag in lockstep with the
package major.

Internal adoption first: this repo's own CI and the `examples/` jobs switch
from the `sync && git diff` recipe to `aie check`, making the project the
action's first user (Spec 007 spirit).

## Requirements

1. `check` MUST NOT write to the working tree — enforced by an e2e test that
   hashes the tree before/after, including the `.ai/state/` directory.
2. `check` exit codes MUST distinguish drift (1) from workspace errors (2);
   both paths tested.
3. `check` and `sync` MUST agree: if check reports clean, sync immediately
   after reports all-unchanged (e2e property test).
4. The action MUST work on a repo that has committed generated artifacts and
   no Node setup of its own.
5. Annotation output MUST point at the *generated* file paths, since those are
   what reviewers see in the PR diff.

## Acceptance criteria

- e2e: modify a source rule without syncing → `check` exits 1 naming the stale
  root files; run `sync`; `check` exits 0.
- e2e: pre-existing unowned divergent `CLAUDE.md` → `check` exits 2 with the
  collision diagnostic, not 1.
- This repo's CI uses the action for its own drift check.

## Out of scope

- `aie diff` with unified content diffs (nice later; `git diff` after sync
  already serves users who want hunks).
- Watch mode.
- GitLab/other CI templates (document the exit codes; let users compose).
