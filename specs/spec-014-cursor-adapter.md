# Spec 014: Cursor adapter

- Status: **Shipped in 0.2.0**
- Priority: P2 (deliberately last: breadth after correctness)
- Target release: 0.4.x
- Depends on: Spec 001–003, Spec 005; frontmatter model shared with Spec 009
- Review finding: a third adapter roughly doubles the addressable audience
  (Claude Code + Cursor is the most common team mix) and proves the registry
  abstraction with a third data point. It is sequenced after the trust and
  differentiation work because breadth-first is the fight the rulesync cluster
  already wins.

## Problem

Cursor loads project rules from `.cursor/rules/*.mdc` files with YAML
frontmatter controlling scope (`description`, `globs`, `alwaysApply`). Plain
Markdown copy is not enough; the adapter needs rule metadata the current
loader does not model.

## Design

### Source metadata (loader change, shared with Spec 009)

Optional YAML frontmatter on `.ai/rules/*.md`, parsed by the loader into
`metadata` on the normalized entry. Runtime-neutral keys only:

```markdown
---
description: Testing policy for this repository
scope: "src/**/*.ts"       # optional glob; absent = always applies
---
Run the full suite before merging. ...
```

- Claude and Codex adapters strip frontmatter and render the body (`scope` is
  recorded but unenforced there until those runtimes can express it —
  documented in `docs/comparison.md`'s capability table).
- Unknown frontmatter keys: `warning` diagnostic (strict-mode error), keeping
  the vocabulary deliberate.

### Cursor adapter surface

```js
export const id = "cursor";
export const surface = {
  version: 1,
  artifacts: [{ id: "rules", kind: "directory", path: ".cursor/rules" }],
};
export const capabilities = {
  agents: "unsupported",
  commands: "unsupported",
  hooks: "unsupported",
};
```

Mapping per manifest-listed rule → `.cursor/rules/<name>.mdc`:

```
---
description: Testing policy for this repository
globs: src/**/*.ts
alwaysApply: false
---
Run the full suite before merging. ...
```

- No `scope` → `alwaysApply: true`, no `globs` key.
- No `description` → derived from the first line of the body, truncated at 100
  chars (deterministic).
- Agents and commands produce the Spec 009 `capability-unsupported` info
  diagnostics. Nothing silent.

Ownership, collisions, stale cleanup, and reporting all arrive free via the
Spec 001/002/005 machinery — that being true is part of this spec's purpose:
**a new adapter should be ~100 lines plus tests.** If it is not, the shared
layers need work before the adapter merges.

### Enablement

`targets: { cursor: { enabled: true } }` in the manifest;
`ai.runtimes: [claude, codex, cursor]` in blueprints (Spec 010). `aie init`
gains `--targets claude,codex,cursor` (default unchanged: claude,codex).

### The adapter cookbook

Ship `docs/writing-an-adapter.md` alongside, written by extracting this
adapter's actual construction: contract, surface, capabilities, the shared
transaction, fixture-test pattern. Close with the built-in-vs-external policy:
external adapters are supported today via `compile({ registry })`; built-in
inclusion requires a maintainer commitment to track that runtime's format
changes. This document plus 3–5 seeded `good-first-issue` adapter tickets
(Windsurf, Zed, Copilot instructions) is the contributor on-ramp identified in
the review.

## Requirements

1. Generated `.mdc` files MUST be loadable by current Cursor (manual
   verification per release; automated tests assert format against fixtures).
2. Frontmatter parsing MUST be shared loader code, not Cursor-specific, and
   MUST leave Claude/Codex output for frontmatter-less sources byte-identical
   to pre-frontmatter releases.
3. Determinism and second-sync stability e2e tests extend to the third target.
4. The cross-runtime consistency property (Spec 003) now asserts over three
   runtimes.
5. The adapter implementation MUST NOT import from other adapters (existing
   architecture rule, now tested with three data points).

## Acceptance criteria

- e2e: workspace with 2 rules (one scoped, one not) and 1 agent, all three
  targets enabled → correct `.mdc` files with correct frontmatter; agent
  renders for claude/codex; cursor emits one info diagnostic for it.
- `examples/typescript-library` gains the cursor target and its committed
  output stays drift-checked in CI.
- A contributor following `docs/writing-an-adapter.md` can produce a working
  external adapter without reading compiler source (validated once with a real
  outside tester before the doc is called done).

## Out of scope

- Cursor nested/scoped rules directories beyond `.cursor/rules/` at root
  (monorepo story is a future RFC).
- Any fourth adapter — each addition is its own maintenance-commitment
  decision per the cookbook policy.
