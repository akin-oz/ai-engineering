# Architecture decisions

## Source and build boundaries

`.ai/` is repository-owned input. The npm package is the compiler. Compiler
source does not live under `.ai/`, because that would make every consuming
repository carry and potentially fork compiler implementation.

The package resolves `.ai/manifest.yaml` relative to the project root and
writes generated runtime directories relative to that same root. Output paths
are constrained to remain inside the project root.

## Compilation pipeline

```text
project root
  -> manifest loader
  -> normalized immutable manifest
  -> adapter registry
  -> enabled adapters
  -> generated runtime artifacts
```

The manifest is loaded once and passed to adapters. Adapters do not mutate it.
The compiler does not inspect adapter output formats.

The next architectural layer is the workflow compiler. A schema 2 blueprint is
resolved into a normalized workflow graph and materialized source artifacts
before this adapter pipeline runs. Schema 1 manifests continue to bypass that
phase, preserving the current contract. See the [workflow compiler design](workflow-compiler.md)
for the composition model and migration roadmap.

Adapters own the complete installation surface of each enabled runtime, not
only a runtime directory. This includes root-level instruction files such as
`CLAUDE.md` or `AGENTS.md`, hooks, metadata, and future runtime assets. The
compiler coordinates path ownership and atomic rendering but does not know
which artifacts a runtime requires. See the [runtime parity plan](runtime-parity.md).

## Adapter contract

An adapter is a small module with two exports:

```js
export const id = "runtime";
export async function render(manifest) {}
```

The registry discovers `.mjs` files and validates this contract. This avoids a
central runtime switch and keeps adding a built-in adapter independent from
compiler orchestration. Adapter-specific concerns such as Markdown structure,
copy mappings, manifests, or generated filenames stay inside the adapter.

## Why the registry is injectable

The default registry discovers package-provided adapters. `compile({ registry })`
allows tests, custom distributions, and future plugins to supply adapters
without coupling the compiler to a plugin loader today. Plugin loading is a
future policy layer, not a reason to make the core depend on a plugin system.

## Determinism

Manifest lists are deduplicated while preserving declared order. Directory
traversal is sorted. Adapters must produce stable output from the immutable
manifest and source files. Single-file writes are staged and renamed, and
adapters replace their complete managed output, preventing stale files from
surviving a successful compile. CI can therefore run `ai sync` followed by
`git diff --exit-code`.

Incremental compilation should be added around this pipeline later, using a
content-addressed dependency graph and adapter-declared input/output scopes.
It should not be embedded in individual adapters prematurely.

## Planned extension points

- Diagnostics: `DiagnosticError` already carries structured diagnostic data.
- Graphs: add a graph-building phase between manifest loading and rendering.
- Path-aware rules: extend normalized manifest entries with selectors without
  changing adapter contracts.
- Templates: add a shared template service or adapter-local template policy.
- Plugins: compose registries or load package entry points before compilation.
- Monorepos: make `loadManifest` operate on a discovered workspace root and
  compile each project as an explicit unit.
- Incremental sync: cache normalized inputs and adapter output fingerprints.
- Workflow capabilities: compose reusable development, review, documentation,
  and release packs into a runtime-neutral graph before adapter rendering.

These are intentionally not implemented in v1. The current interfaces leave
those responsibilities outside the filesystem and adapter implementations.
