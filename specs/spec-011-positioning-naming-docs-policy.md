# Spec 011: Positioning, naming, docs policy, and release consistency

- Status: **Partially shipped in 0.2.0** — naming, docs layering, comparison doc, and release consistency done; launch checklist pending
- Priority: P1 (cheap, high leverage; most items land with 0.2.0)
- Target release: 0.2.0 (policy + naming), ongoing (docs)
- Depends on: — (Spec 010 later upgrades the positioning claim)
- Review findings: four names for one project ("AI Engineering OS", repo
  `ai-engineering`, directory `ai-engineering-compiler`, package
  `@akinlabs/ai-engineering`); the "OS" claim invites maximum skepticism for a
  file compiler; `bin: ai` squats a hyper-generic name; ~640 lines of docs
  describe unshipped behavior indistinguishably from shipped behavior; the
  changelog records a 0.1.2 release that npm does not have, and
  `.github/releases/` skips v0.1.1.

## Problem

Every finding above is a trust leak. A senior evaluator reads inconsistent
names, an inflated title, and docs describing vaporware as symptoms of the same
disease. All are fixable in days.

## Decisions

### Name and claim

- Product name: **AI Engineering Compiler**. One name in README title, package
  description, `--help` header, and repo description. "OS" is retired.
- Tagline stays capability-honest: "Keep AI assistant instructions and
  workflows in one reviewable source tree. Compile them for Claude Code and
  Codex." The phrase **"workflow compiler"** enters the positioning only when
  Spec 010 ships something a user can run.
- Repo/package renames are NOT required (npm renames cost more than they
  return at current adoption); consistency of the *display* name is.

### Binary name

`ai` will collide on users' PATHs and is unfindable in search. Rename the
binary to **`aie`**. Ship 0.2.0 with both `aie` and `ai` bins; `ai` prints a
one-line deprecation notice to stderr; remove `ai` in 0.3.0. Current npm
download counts make this the cheapest moment this rename will ever have.

### Docs policy (normative, enforced in review)

1. `docs/` describes **shipped behavior only**. Every statement in `docs/`
   must be exercisable against the released package.
2. Forward-looking design moves to `rfcs/` with a status header
   (`Draft | Accepted | Superseded | Shipped`). Concretely:
   `docs/workflow-compiler.md` → `rfcs/0001-workflow-compiler.md` (Accepted),
   `docs/runtime-parity.md` → `rfcs/0002-runtime-parity.md` (Accepted; Specs
   001/002/009 implement it incrementally and link back).
3. `specs/` holds scoped, implementable units (this directory). When a spec
   ships, its behavior is documented in `docs/`, and the spec's status flips to
   Shipped. Specs are the decomposition layer between RFCs and PRs.
4. README claims must be verifiable at HEAD: the dogfooding paragraph (Spec
   007), the supported-runtimes list, and the quick start are checked against
   reality on every release (release checklist below).

### Comparison document

New `docs/comparison.md`, linked prominently from the README ("Why not just
…?"). Sections, each answered honestly including where the alternative wins:

- symlinking `CLAUDE.md → AGENTS.md` (wins for single-file rule sync; loses at
  agents/commands/hooks and drift detection);
- the AGENTS.md standard itself (this tool targets what the standard doesn't
  cover; we generate a standard-compliant AGENTS.md, not a competitor to it);
- rulesync and the rules-sync tool cluster (they win on target breadth; this
  tool's bets are ownership-safe writes, capability diagnostics, and compiled
  workflows);
- git submodules / template repos; manual maintenance.

Naming competitors by name is a trust signal, not a risk — evaluators find
them in one search anyway.

### Release consistency

1. Reconcile now: publish 0.1.2 to npm as-is, or mark the changelog entry
   `[0.1.2] - Unreleased`. The changelog may never claim a release npm lacks.
2. Every released version has: a git tag, an npm publish, a changelog section,
   and a `.github/releases/vX.Y.Z.md` note — all four or none. Add the missing
   `v0.1.1.md` retroactively.
3. Extend `docs/release-process.md` with a checklist enforcing the above plus
   the README-claims audit; add a CI check that the changelog contains a
   section for `package.json`'s version at publish time (the publish workflow
   already exists to host it).

### Launch checklist (tracked here, not engineering work)

Post-0.2.1 (after Specs 001–008): demo video/GIF in README; Show HN-style
writeup that answers the rulesync comparison in paragraph one; convert 2–3
visible OSS repos via PR; seed 5 `good-first-issue` tickets (adapter cookbook
tasks, diagnostic codes). Blocked until the trust release, because launching
the current build converts attention into the settings-deletion issue report.

## Requirements

1. Grep-level consistency: `git grep -i "engineering os"` returns nothing
   after this spec lands.
2. `rfcs/` exists, both design docs moved with status headers and links to
   their implementing specs; `docs/` contains no claims about unshipped
   behavior.
3. `docs/comparison.md` exists and is linked from the README's problem section.
4. Changelog/npm/tags/release-notes reconciled per the rule above.

## Acceptance criteria

- A first-time reader can determine, from directory alone, whether any
  statement is shipped (`docs/`), planned-scoped (`specs/`), or visionary
  (`rfcs/`).
- `npx aie --help` works from the packed package; `npx ai --help` works and
  warns; both covered by the package-smoke CI job.

## Out of scope

- Any repo or npm-scope rename.
- Website/landing page.
