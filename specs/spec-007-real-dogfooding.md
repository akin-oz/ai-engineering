# Spec 007: Real dogfooding, enforced by CI

- Status: **Shipped in 0.2.0**
- Priority: P1 (first after the 0.2.0 trust release)
- Target release: 0.2.1
- Depends on: Spec 002–005
- Review finding: every file in this repo's `.ai/agents/` and `.ai/rules/` is
  0 bytes. The committed `.codex/AGENTS.md` is a banner followed by nothing.
  The README's "This repository also dogfoods the compiler" is a verifiable
  claim that fails verification — worse than no claim at all.

## Problem

The repo is the first example every evaluator inspects. It must demonstrate the
tool doing real work, and CI must make hollow dogfood impossible to reintroduce.

## Design

### Content

Write the real rules and agents this repository actually wants its assistants
to follow. The engineering opinions already exist — they're currently spread
across `docs/architecture.md` and `CONTRIBUTING.md`. Move the operational ones
into `.ai/` where they do double duty as product demo and working guidance.

Minimum content set (final wording is the maintainer's; topics are normative):

- `rules/engineering.md` — the actual constraints: no new runtime dependencies
  without an ADR; adapters never import from other adapters; every path written
  must be inside the project root; determinism requirements for generated
  output.
- `rules/testing.md` — every diagnostic code has trigger + non-trigger tests;
  behavior changes land with an e2e case (Spec 006); `npm test` must pass on
  Node 20/22/24.
- `rules/docs.md` — the docs policy from Spec 011: `docs/` describes shipped
  behavior only; forward-looking design lives in `rfcs/`; changelog entry for
  every user-visible change.
- `agents/staff-engineer.md`, `agents/security.md` — real role prompts (review
  focus areas, what to reject), or delete the files. No placeholder bodies.

Reconcile the manifest with reality (Spec 003 makes the mismatch a warning):
every kept file is listed; every listed file has substantive content.

### CI enforcement

New script `scripts/verify-dogfood.mjs`, run in CI after `ai sync`:

1. Every file under `.ai/agents/`, `.ai/rules/`, `.ai/commands/` contains ≥ 80
   non-whitespace characters. (Catches the exact 0-byte failure shipped today.)
2. Every manifest-listed rule id appears as rendered content in both root
   `CLAUDE.md` and `AGENTS.md`.
3. Generated root files contain no unresolved `{{` placeholder.

These checks run against this repo and every `examples/` directory (Spec 008).
They are repo-CI checks, not compiler features — the compiler-level equivalents
are the Spec 005 warnings, which stay warnings so real users can stage drafts.

### README claim

The dogfooding paragraph links directly to the generated `CLAUDE.md` and
`AGENTS.md` so the claim is one click from its proof. Add the CI badge line
only if it stays green.

## Requirements

1. No 0-byte or placeholder-body file under `.ai/` in this repository, enforced
   by CI, effective from the commit this spec ships in.
2. The repo's own `ai validate --strict` MUST pass in CI (Spec 005) — the
   strict mode the project recommends to users applies to itself.
3. The manifest, source files, and both compiled outputs MUST agree (no
   unlisted files, no missing sources).

## Acceptance criteria

- A PR that empties `.ai/rules/engineering.md` fails CI at `verify-dogfood`.
- A PR that adds `.ai/agents/new.md` without listing it fails CI at
  `ai validate --strict` (source-unlisted promoted to error).
- An outside reader can open `CLAUDE.md` at the repo root and see the actual
  engineering rules of the project.

## Out of scope

- Example repositories (Spec 008).
- Demo video / README media (worth doing alongside this; not an engineering
  spec — tracked as a release task in Spec 011's launch checklist).
