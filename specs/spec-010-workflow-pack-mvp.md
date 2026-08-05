# Spec 010: Workflow pack MVP — one pack, end to end, before any engine

- Status: **Shipped in 0.2.0**
- Priority: P1 (the differentiation bet)
- Target release: 0.4.0
- Depends on: Spec 002–005; benefits from Spec 009
- Review finding: the workflow-compiler design (`docs/workflow-compiler.md`) is
  the project's only differentiated idea and is 100% unimplemented. Its full
  scope (capability registry, graph composition, conflict detection,
  provenance) is a multi-month solo build. The risk is spending six months on
  an engine before one workflow has one user.

## Problem

Prove "blueprint in → working engineering workflow out" with exactly one
hardcoded workflow, deferring every piece of the general engine that the single
case does not force. The RFC remains the north star; this spec is the smallest
honest step toward it.

## Design

### Blueprint (schema 2, minimal)

`.ai/blueprint.yaml`:

```yaml
schema: 2

project:
  type: library            # accepted but only recorded in provenance for now

workflow:
  development: spec-driven # the ONLY accepted value in this release

ai:
  runtimes: [claude, codex]
```

Strict validation: unknown fields, unknown workflow names, and unknown runtimes
are errors (per the RFC's strict mode). `blueprint.yaml` and a hand-authored
schema-1 `manifest.yaml` are mutually exclusive — both present is an error
telling the user to pick one. Schema 1 workspaces continue to work unchanged.

### The `spec-driven` pack

Shipped inside the npm package at `packs/development/spec-driven/`, versioned
with the package (no independent pack versioning yet). Contents — real,
usable material, held to Spec 007 content standards:

```
packs/development/spec-driven/
├── pack.yaml                  # id, contributes list (used for provenance)
├── agents/spec-author.md      # drafts/updates the spec before implementation
├── agents/implementer.md      # implements against the active spec
├── rules/spec-first.md        # no behavior change without a spec delta
├── rules/change-boundary.md   # keep diffs scoped to the spec item
├── commands/spec.md           # /spec — create or revise a spec from a request
└── templates/spec-template.md # the spec document skeleton
```

### Materialization

`ai sync` with a blueprint runs one extra phase before adapters:

```
load blueprint → select pack (hardcoded lookup) → materialize .ai/generated/
  → build normalized manifest from .ai/generated/ → existing adapter pipeline
```

- `.ai/generated/` is **committed** (reviewability is the philosophy) and is
  replaced wholesale on each sync — it is compiler-owned per the RFC, tracked
  in an ownership record like any target (Spec 001 machinery reused).
- User additions live outside `generated/`: rules/agents placed in the regular
  `.ai/rules|agents/` directories are appended to the normalized manifest after
  pack content. Name collisions between user files and pack contributions are
  errors, not merges — the RFC's conflict semantics, trivially enforced.
- Each generated file carries a provenance header comment:
  `generated-by: development/spec-driven@0.4.0`.

### `ai explain`

Minimal implementation, blueprint mode only:

```
workflow: spec-driven (packs/development/spec-driven@0.4.0)
  agent  spec-author        → claude, codex
  agent  implementer        → claude, codex
  rule   spec-first         → claude, codex
  rule   change-boundary    → claude, codex
  command spec              → claude (codex: unsupported)
```

This is a formatted read of provenance + the Spec 009 capability results — no
new analysis machinery.

### What is deliberately NOT built

No capability registry, no dependency graph, no topological merge, no
`overrides:`, no `preferences:`, no second pack. Each of those enters only via
a future spec when a concrete user need forces it, per the RFC's phased plan.
If a second workflow (e.g. `tdd`) is demanded before the engine exists, it may
be added as a second hardcoded pack — two data points before one abstraction.

## Requirements

1. `ai init --blueprint` writes the blueprint above plus empty user source
   dirs; `init` without the flag keeps the schema-1 behavior (Spec 004).
2. Blueprint compile MUST be deterministic: same blueprint + same package
   version → byte-identical `.ai/generated/` and runtime outputs.
3. Pack content is subject to the Spec 007 CI content guard and compiles
   through both adapters in an e2e test.
4. Editing a file under `.ai/generated/` and syncing MUST surface as a
   collision (Spec 001), pointing the user at overrides-via-user-directories.
5. Schema-1 repositories MUST compile unchanged; the blueprint path adds no
   cost to them (lazy-load the pack machinery).

## Acceptance criteria

- Clean room: `ai init --blueprint && ai sync` → `CLAUDE.md`, `AGENTS.md`,
  `.claude/agents/spec-author.md`, `.claude/commands/spec.md` all exist with
  real content; `ai explain` prints the table above.
- Five external users run the spec-driven workflow on real repos before any
  engine work is scheduled. (Not a CI gate — the go/no-go criterion for
  building Phase-2-of-the-RFC, recorded here so it is not forgotten.)

## Out of scope

- Everything in `docs/workflow-compiler.md` Phases 2–5: registry, graph,
  conflicts beyond name-collision, presets, wizard, lockfiles, remote packs.

## Migration

None — purely additive. The RFC's promise stands: schema 1 never breaks, and
migration to blueprints is always explicit, never implicit.
