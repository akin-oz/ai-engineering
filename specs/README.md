# Specs

Scoped, implementable specifications derived from the August 2026 independent
product review. Each spec is sized to become one milestone of a few PRs.

Layering (see Spec 011): `rfcs/` holds vision, `specs/` holds committed scoped
work, `docs/` describes shipped behavior only. When a spec ships, its behavior
moves into `docs/` and the spec's status flips to Shipped.

## Index

| # | Spec | Status | Depends on |
| --- | --- | --- | --- |
| 001 | [Ownership and non-destructive sync](spec-001-ownership-and-non-destructive-sync.md) | Shipped | — |
| 002 | [Root artifacts and adapter surface](spec-002-root-artifacts-and-adapter-surface.md) | Shipped | 001 |
| 003 | [Manifest selection semantics](spec-003-manifest-selection-semantics.md) | Shipped | 002 |
| 004 | [First-run experience](spec-004-first-run-experience.md) | Shipped | 002, 003 |
| 005 | [Validation and reporting](spec-005-validation-and-reporting.md) | Shipped | 002, 003 |
| 006 | [End-to-end test suite](spec-006-end-to-end-test-suite.md) | Shipped | 001–005 |
| 007 | [Real dogfooding](spec-007-real-dogfooding.md) | Shipped | 002–005 |
| 008 | [Example repositories](spec-008-example-repositories.md) | Shipped | 002–005, 007 |
| 009 | [Agents, commands, hooks compilation](spec-009-agents-commands-hooks-compilation.md) | Shipped | 001–003, 005 |
| 010 | [Workflow pack MVP](spec-010-workflow-pack-mvp.md) | Shipped | 002–005 |
| 011 | [Positioning, naming, docs policy](spec-011-positioning-naming-docs-policy.md) | Partial — launch checklist pending | — |
| 012 | [`aie check`, dry-run, CI action](spec-012-check-dry-run-and-ci-action.md) | Shipped | 001, 005 |
| 013 | [`aie adopt` importer](spec-013-adopt-importer.md) | Shipped | 001, 004, 005 |
| 014 | [Cursor adapter](spec-014-cursor-adapter.md) | Shipped | 001–003, 005 |

Everything except the Spec 011 launch checklist is implemented and tested in the
unreleased 0.2.0.

## Why one release instead of four

These specs planned a 0.2.0 → 0.2.1 → 0.3.x → 0.4.x train. All of it landed
before 0.2.0 was published, so shipping it as four versions would mean writing
changelog sections for releases npm never received — which the
[docs rule](../.ai/rules/docs.md) forbids. One unreleased version absorbed the
lot. The per-spec "target release" lines are left as written: they record the
plan, not what happened.

## Where the implementation departed from these specs

Recorded here because a spec that silently disagrees with the code is worse
than no spec.

- **No staging directory** (spec 001 step 2). Adapters return file contents, and
  the compiler compares and writes per file. Collision detection still happens
  before any write, so the guarantee is unchanged, and purity makes `check`
  possible without a temporary tree.
- **Ownership records omit the tool version** (spec 001). Recording
  `@akinlabs/ai-engineering@0.2.0` would rewrite every repository's committed
  state on each release and break `aie check` in CI until someone re-synced.
  The records name the tool without the version.
- **Legacy direct-write adapters are no longer supported** (spec 002). Keeping
  them would mean keeping the whole-directory replacement path alive, which
  contradicts ground rule 1. `render` returning anything but a `files` array is
  now an error, documented as breaking in the changelog.
- **`.codex/` is not generated at all** (spec 002 kept it for Codex-specific
  configuration). Nothing meaningful was written there, and an empty reserved
  directory is clutter.
- **Owned settings entries carry no marker field** (spec 009 proposed
  `"id": "aie:<hook>"`). Claude Code validates `settings.json`, and injecting an
  unrecognized key to identify our own entries is a bad trade. Ownership is
  proven the same way it is everywhere else in this compiler: the entries are
  recorded verbatim, and a mismatch means the user edited one.
- **Hooks declare an event but not a file matcher** (spec 009 showed
  `matcher: "*.ts"`). Claude's matcher selects *tools*, not paths, so accepting
  a file glob there would have quietly done nothing. Path filtering belongs in
  the hook script, which receives the tool input.
- **`pre-commit` is not a hook event** (spec 009 listed it). No supported
  runtime has one — it is a git concept — so the vocabulary is `pre-edit`,
  `post-edit`, `session-start`, `session-end`.
- **Adopt writes provenance as frontmatter keys**, and those keys are accepted
  by the rule metadata validator. Otherwise every adopted rule would warn on
  every run, and `--strict` would fail on a freshly adopted workspace.

## What remains

The only unfinished item is Spec 011's launch checklist: demo recording, the
comparison-led writeup, converting outside repositories via pull request, and
seeding `good-first-issue` tickets. That work is deliberately blocked until
0.2.0 is published, because attention arriving before the fix converts into an
issue report about the 0.1 behavior.

Natural next specs, none of which exist yet:

- **Skills and MCP server configuration**, now that the settings-merge model has
  a working implementation to build on.
- **A second workflow pack** — but only after `spec-driven` has real users. The
  capability registry, dependency graph, and conflict resolution in
  [RFC 0001](../rfcs/0001-workflow-compiler.md) stay unbuilt until two concrete
  packs make the abstraction obvious rather than speculative.
- **Monorepo project units**, the most-requested shape this design does not
  handle.

## Ground rules carried across all specs

1. Never delete or overwrite a file the compiler cannot prove it created
   (Spec 001 — no other spec may weaken this).
2. Same inputs + same package version → byte-identical outputs, always.
3. Nothing is skipped silently: every unexpressible or ignored input produces
   a diagnostic with a stable code.
4. Every behavior claim in README/docs is verifiable at HEAD; CI enforces the
   ones that can be automated (Specs 006, 007).
5. Schema 1 workspaces keep compiling through every release in this index.
