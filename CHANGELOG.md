# Changelog

## [0.3.0] - 2026-08-08

Everything here comes from one repository adopting 0.2.0 and logging what it
had to hand-wire because the compiler could not express it. Each item below is
one of those workarounds, deleted.

### Added

- **Hooks in blueprint workspaces.** A `hooks:` block works in
  `.ai/blueprint.yaml` exactly as it does in a manifest. Choosing a workflow no
  longer forfeits the hook vocabulary, which it silently did before.
- **`turn-end` hook event**, compiling to Claude Code's `Stop`. End-of-turn
  verification gates were previously inexpressible.
- **`pre-tool` and `post-tool` events with a `tools` field**, so a hook can fire
  for the tools it actually cares about (`tools: [Bash]` for a commit guard).
  `pre-edit` and `post-edit` remain sugar for the edit tools. Declaring `tools`
  on an event that does not fire for a tool is an error rather than an ignored
  field.
- **Workflow packs can contribute hooks.** Pack scripts are materialized to
  `.ai/generated/hooks/` and arrive executable, because npm does not reliably
  preserve file modes in a published tarball.
- **`workflow.disable`** drops a single pack contribution by name
  (`disable: [hook.spec-trailer]`). Adopting a workflow is no longer all or
  nothing. Naming a contribution the pack does not have is an error listing
  what it does have, so a typo cannot look like it worked.
- The `spec-driven` pack now ships the mechanism behind its own rules: a
  `Spec:` commit trailer convention, a rule documenting it with the CI check,
  and a hook that refuses a commit without one. The hook fails open — a hook bug
  must never be why someone cannot commit.

### Changed

- **`spec-driven` is now version 2.** Blueprint users will see `aie check`
  report drift after upgrading; run `aie sync`. Because the pack now contributes
  a hook, it also begins merging into `.claude/settings.json` for the first
  time. Entries you wrote by hand are preserved, as always. To keep that file
  untouched, add `disable: [hook.spec-trailer]`.
- `aie explain` reports the project type, gives the path a template is read from
  instead of "source only", and lists contributed hooks.
- A blueprint's `project` and `stack` are recorded in workflow provenance rather
  than validated and discarded.
- The deprecated `ai` binary now names 0.4.0 as its removal release. It was
  announced for 0.3.0, but removing it in the same release that fixes an
  adopter's blockers would have made upgrading harder than it needs to be.

### Fixed

- A floating `v0` tag now exists and moves with each release, so
  `uses: akin-oz/ai-engineering@v0` resolves. Only exact version tags existed
  before, and the README documented a tag that did not.

## [0.2.0] - 2026-08-04

The trust release. Version 0.1 wrote its output where neither runtime reads it
and deleted files it did not create; both are fixed here, and both are now
regression-tested end to end.

### Fixed

- `aie sync` no longer deletes files it did not generate. Every target records
  the files it owns in `.ai/state/targets/<id>.json`, and a file is only removed
  or overwritten when that record lists it, when its bytes still match the source
  it was copied from, or when it carries the generated banner. A pre-existing
  `.claude/settings.json` now survives a sync.
- Generated instructions now land where the runtimes load them: a root
  `CLAUDE.md` and a root `AGENTS.md`. Codex reads the repository root, so the
  previous `.codex/AGENTS.md` was never loaded.
- `aie init` seeds a rule and working templates, so `init` followed by `sync`
  produces real instructions instead of an empty banner. The template it wrote
  previously had no placeholders, so Codex output stayed empty permanently.
- Both targets now compile the same set of sources. The Claude adapter copied
  whole directories while Codex used the manifest lists, so the two runtimes
  could disagree about which agents and rules existed.
- Sync reporting names artifacts and actions instead of counting directories as
  files.

### Added

- `aie check` reports drift without writing: exit 0 clean, 1 out of date, 2
  workspace error. `aie sync --dry-run` is the same check.
- A GitHub Action (`uses: akin-oz/ai-engineering@v0`) that runs `aie check`,
  annotates drifted files on the pull request, and writes a job summary.
- `aie adopt` imports existing `CLAUDE.md`, `AGENTS.md`, `.claude/agents/`,
  `.claude/commands/`, `.cursor/rules/`, and Copilot instructions into `.ai/`.
  It is a dry run by default, never modifies the files it reads, and flags pairs
  that look like the same policy written twice instead of merging them.
- **Hook compilation.** Hooks are declared in the manifest with a normalized
  event (`pre-edit`, `post-edit`, `session-start`, `session-end`) and a script
  under `.ai/`. The Claude adapter copies the script, preserves its executable
  bit, and wires it into `.claude/settings.json` — owning only the entries it
  wrote there. Everything else in that file is preserved, and a generated entry
  someone edited by hand is reported rather than overwritten.
- **A Cursor adapter**, generating `.cursor/rules/*.mdc`. Rules may carry
  `description` and `scope` frontmatter; `scope` becomes Cursor's `globs`, and
  its absence becomes `alwaysApply: true`.
- **Workflow blueprints (schema 2).** `.ai/blueprint.yaml` names an engineering
  workflow instead of listing files. `aie sync` composes a versioned pack into a
  committed, reviewable `.ai/generated/`, then compiles it for each runtime.
  One workflow ships: `spec-driven`. `aie init --blueprint` creates one, and
  `aie explain` shows what the workflow contributed and where each piece lands.
- Rule frontmatter is parsed into runtime-neutral metadata; agent and command
  frontmatter passes through to the runtime untouched.
- `--strict` (warnings become errors), `--force` (overwrite unowned files and
  take ownership), `--write` (apply an adoption), `--blueprint`, and `--json`.
- Diagnostics with stable codes for missing, empty, and unlisted sources,
  templates that would drop declared content, unused hook scripts, unknown hook
  events, unknown rule metadata, hand-edited settings entries, deprecated
  template names, path collisions, workflow conflicts, and capabilities a
  runtime cannot express. Every skipped input is reported rather than dropped.
- Optional `commands` sources, compiled to `.claude/commands/`.
- Optional `surface`, `capabilities`, and merge declarations on adapters,
  validated for path containment and duplication.
- An end-to-end test suite that drives the real CLI against temporary
  repositories, plus a CI guard that fails when a workspace compiles to nothing.
- Examples for the three real cases: a minimal workspace, a multi-runtime
  library, and a repository already carrying drifted instruction files.

### Changed

- **The `ai` command is now `aie`.** `ai` still works and prints a deprecation
  warning; it will be removed in 0.3.0.
- **Breaking (adapters): `render(manifest, context)` must return
  `{ files: [{ path, contents }] }` and must not write to disk.** The compiler
  owns every write, which is what makes ownership records and `check` possible.
  When an adapter merges into a file the user also edits, the compiler pre-reads
  it and supplies it through `context` rather than letting the adapter reach for
  the filesystem.
- Rules are inlined into `CLAUDE.md` rather than copied to `.claude/rules/`, so
  the same context is not injected twice. Copies from 0.1 that still match their
  source are removed automatically; modified ones are preserved and reported.
- `.codex/` is no longer generated. A `.codex/AGENTS.md` carrying the generated
  banner is removed on the next sync; one without it is left alone.
- The Codex template is now `.ai/templates/agents.md`. `codex-agents.md` still
  works with a deprecation warning.
- `.ai/hooks/` is no longer copied wholesale. Hook scripts are declared in the
  manifest and wired into the runtime; a script nothing declares is reported
  rather than copied somewhere it would never run.
- Design documents moved to `rfcs/`; `docs/` now describes shipped behavior
  only. Scoped work in progress lives in `specs/`.
- The project is named "AI Engineering Compiler". The package name is unchanged.

### Migration from 0.1.x

Run `aie sync`. Generated files that are unchanged are adopted silently; a
`CLAUDE.md` or `AGENTS.md` you wrote by hand is reported as a collision, and you
can move it aside or run `aie sync --force` after checking the diff. Replace
`ai` with `aie` in scripts, and `npx aie sync && git diff --exit-code` with
`npx aie check`.

## [0.1.2] - Unreleased

Documented in the changelog but never published to npm; superseded by 0.2.0.

### Added

- Workflow compiler architecture for declarative, reusable engineering workflows.
- Runtime parity contract for complete adapter-owned installations.

## [0.1.1] - 2026-08-02

### Added

- `ai init` for bootstrapping a minimal `.ai` workspace.
- Actionable guidance when `ai sync` runs before initialization.

## [0.1.0] - 2026-08-02

### Added

- Tool-agnostic `.ai` workspace manifest and source model.
- Claude Code and Codex runtime adapters.
- Deterministic compilation and generated-output cleanup.
- `ai sync`, `ai validate`, `ai --help`, and `ai --version`.
- Public compiler and adapter registry APIs.
- Node.js test suite, package smoke test, and GitHub Actions verification.
