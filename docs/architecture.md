# Architecture

This describes what the compiler does today. Forward-looking design lives in
[rfcs/](../rfcs); scoped work in progress lives in [specs/](../specs).

## Source and build boundaries

`.ai/` is repository-owned input. The npm package is the compiler. Compiler
source does not live under `.ai/`, because that would make every consuming
repository carry and potentially fork compiler implementation.

The package resolves `.ai/manifest.yaml` relative to the project root and writes
generated artifacts relative to that same root. Every generated path is
validated to stay inside the project root and outside `.ai/`.

## Pipeline

```text
project root
  -> workspace loader        blueprint or manifest, whichever exists
  -> workflow composition    blueprint only: pack -> .ai/generated sources
  -> normalized manifest     immutable, deeply frozen, contents included
  -> adapter registry
  -> enabled adapters        render(manifest, context) -> file contents
  -> plan                    paths validated, cross-adapter collisions rejected
  -> comparison              against the working tree and ownership records
  -> transaction             writes, stale cleanup, ownership records
```

`aie validate` stops after the plan. `aie check` stops after the comparison.
`aie sync` runs the transaction.

## Two ways to describe a workspace

`.ai/manifest.yaml` (schema 1) lists sources by hand. `.ai/blueprint.yaml`
(schema 2) names a workflow, and the compiler composes a versioned pack into
`.ai/generated/` before adapters run. Both produce the same normalized
manifest, so adapters never learn which was used. Having both is an error.

Materialized sources are written through the same ownership machinery as any
other artifact, under a `workspace` target — which is why `.ai/generated/` is
drift-checked by `aie check` like everything else, and why it is the one place
inside `.ai/` the compiler may write.

## Adapters are pure

An adapter exports an id and a `render(manifest, context)` function returning
file contents:

```js
export const id = "example";
export async function render(manifest, context) {
  return { files: [{ path: "EXAMPLE.md", contents: "..." }] };
}
```

Adapters never write to disk, never read generated output, and never import each
other. The compiler owns every write, which is what makes ownership tracking,
collision detection, and `check` possible at all. When an adapter merges into a
file the user also edits, the compiler pre-reads that file and passes it in
`context` rather than letting the adapter reach for it. See the
[adapter contract](adapter-api.md) and
[writing an adapter](writing-an-adapter.md).

## Ownership

The compiler may only delete or overwrite a file it can prove it created:

1. the file is listed in the target's ownership record
   (`.ai/state/targets/<id>.json`, committed to the repository);
2. its bytes still match the source it was copied from; or
3. it carries the generated banner.

Anything else is a collision: the sync reports every colliding path and stops
before writing. `--force` overwrites them and takes ownership.

Stale files — recorded as owned but no longer generated — are removed, and
directories left empty by that removal are pruned. A directory containing
anything else is never touched.

Some files are shared rather than owned outright. `.claude/settings.json`
belongs to the user; the compiler owns only the hook entries it wrote there,
recorded verbatim in the ownership record. On the next sync it replaces exactly
those entries, leaves everything else alone, and reports an error instead of
overwriting if one of them was hand-edited.

## Determinism

Manifest lists are deduplicated while preserving declared order, directory
traversal is sorted, and section rendering is shared by every adapter so
ordering cannot drift between runtimes. Ownership records deliberately omit the
tool version so a release does not rewrite every repository's committed state.

The same source tree and package version always produce byte-identical output,
which is what makes `aie check` usable as a CI gate.

## Diagnostics

Loading and planning collect diagnostics rather than failing on the first
problem, so a broken workspace can be fixed in one pass. Errors abort; warnings
print and continue; `--strict` promotes warnings to errors. Every diagnostic
carries a stable code — an input that is ignored or unsupported always produces
one rather than being dropped silently.
