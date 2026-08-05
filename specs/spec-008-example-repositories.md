# Spec 008: Examples that earn trust

- Status: **Shipped in 0.2.0**
- Priority: P1
- Target release: 0.2.1
- Depends on: Spec 002–005, Spec 007; the adoption example additionally on Spec 013
- Review finding: the single `examples/basic` demo predates the root-artifact
  fix (its `AGENTS.md` lives at `.codex/AGENTS.md`) and demonstrates one
  one-line rule — below the tool's own "you don't need this" threshold from the
  README.

## Problem

Examples are the argument. Each must depict a scenario where hand-maintaining
files is genuinely worse, and each must be compiled and drift-checked in CI so
they can never rot into the current state.

## Design

Three examples, each a self-contained directory with its own README explaining
*why this scenario needs the compiler*:

### `examples/basic` (update)

Smallest complete workspace. One rule, one agent, one command, both targets.
Regenerated for the 0.2 surface: root `CLAUDE.md`, root `AGENTS.md`,
`.claude/agents/`, `.claude/commands/`, ownership records. Its README walks the
before/after file tree.

### `examples/typescript-library` (new)

The realistic mid-size case the README's "who is this for" describes:

- 4–6 rules (code style, testing policy, release policy, docs policy);
- 2 agents (reviewer, release-manager) with distinct role prompts;
- 2 commands (e.g. `changeset`, `review-pr`);
- both targets enabled.

The README shows the payoff move: change one rule in `.ai/rules/testing.md`,
run `ai sync`, and point at the same change landing in `CLAUDE.md`,
`AGENTS.md`, and the command files — the demo that justifies the tool's
existence in 30 seconds.

### `examples/adopt-existing` (new, ships with Spec 013)

A repo frozen in the "before" state — a hand-written `CLAUDE.md`, an
`AGENTS.md` that has drifted from it (deliberately different wording of the
same policy), and a `.cursor/rules/` file. Its README is the `ai adopt`
walkthrough: run adopt, inspect the generated `.ai/`, run sync, show the drift
resolved. This example doubles as the fixture for adopt's e2e tests.

### CI

One job per example (or a matrix): `npx ai validate --strict && npx ai sync &&
git diff --exit-code`, plus the Spec 007 dogfood-content guard. An example
that stops compiling or drifts from its committed output fails the build.

## Requirements

1. Every example MUST be compiled by CI on every push; committed outputs MUST
   match regenerated outputs exactly.
2. Example content MUST be plausible for its stated scenario — no lorem-ipsum
   rules, no empty files (Spec 007 guard applies).
3. Each README MUST state, in its first paragraph, why hand-maintenance fails
   for this scenario — the examples argue the product case, not just the
   mechanics.
4. The root README links each example with a one-line description.

## Acceptance criteria

- `git grep -c '' examples/*/\.ai/rules/*.md` shows no empty files.
- Deleting a committed generated file in any example fails CI.
- A reader following `examples/typescript-library/README.md` end-to-end needs
  no other documentation to reproduce the result.

## Out of scope

- Converting external OSS repos via PR (the strongest trust move, but it lives
  outside this repository; tracked as a launch task in Spec 011).
- Framework-specific examples (Next.js, Django, …) — add only when a real user
  asks; each is a permanent maintenance surface.
