# Public API

```js
import {
  adopt,
  compile,
  createAdapterRegistry,
  inspect,
  loadBlueprint,
  loadManifest,
  loadWorkspace,
  planAdoption,
  plan,
  validate,
  validateAdapterRegistry,
  DiagnosticError,
} from "@akinlabs/ai-engineering";
```

All functions accept `{ root, manifest, registry, adapterDirectory, strict,
force }`. `root` defaults to `process.cwd()`.

## `loadWorkspace(root, { diagnostics })`

Loads whichever workspace description exists — `.ai/blueprint.yaml` (schema 2,
composes a workflow pack) or `.ai/manifest.yaml` (schema 1, lists sources by
hand) — and returns the same normalized manifest either way. Having both is an
error.

## `loadManifest(root, { diagnostics })`

Loads `.ai/manifest.yaml` specifically. Reads every declared source file and
returns a deeply frozen manifest. Missing sources throw a `DiagnosticError`
listing all of them. Empty, unlisted, and unsupported sources are recorded on
the optional diagnostics collector as warnings.

The manifest exposes `version`, `root`, `sourceRoot`, `targets`, the declared
name lists (`agents`, `rules`, `commands`), `sources` (including `hooks`),
`files`, `generated`, `workflow`, and `resolve`.

## `loadBlueprint(root, { diagnostics })`

Loads `.ai/blueprint.yaml`, resolves its workflow pack, and returns the same
manifest shape with `generated` populated — the source files the workflow
materializes into `.ai/generated/`.

## `plan(options)`

Renders every enabled target without touching the filesystem. Returns
`{ manifest, registry, diagnostics, targets }` where each target carries its
planned `files` and legacy `remove` entries. Rejects paths that escape the
project root, write into `.ai/`, or are claimed by two adapters.

## `inspect(options)`

Runs `plan`, then compares it against the working tree and the ownership
records. Returns the plan plus:

```js
{
  targets: [{ id, files, artifacts, paths, removed }],
  collisions: [{ target, path }],
  changed: false,
}
```

Each artifact has an `action` of `created`, `updated`, `unchanged`, or
`collision`. Writes nothing — this is what `aie check` runs.

## `compile(options)`

Runs `inspect`, then commits: writes changed artifacts, removes stale and proven
legacy files, prunes emptied directories, and updates ownership records. Throws
on collisions unless `force` is set. Returns the inspection result.

## `validate(options)`

Alias for `plan`. Validates the workspace and every adapter's output without
comparing against the working tree.

## `planAdoption(root)` and `adopt(root, { write })`

Import existing assistant files into `.ai/`. `planAdoption` returns
`{ writes, skipped, duplicates, manifest }` without touching anything; `adopt`
applies that plan when `write` is set. Neither ever modifies or deletes the
files it reads.

## `createAdapterRegistry(directory)` and `validateAdapterRegistry(registry)`

Discover or validate adapters. Both return a frozen array. Supplying `registry`
to `compile` is the supported way to use an external adapter.
