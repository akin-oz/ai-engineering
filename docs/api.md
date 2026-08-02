# Public API

The package entry point is intentionally small:

```js
import {
  compile,
  createAdapterRegistry,
  loadManifest,
  validate,
  validateAdapterRegistry,
} from "@akinlabs/ai-engineering";
```

## `loadManifest(root = process.cwd())`

Loads `.ai/manifest.yaml`, validates referenced source files, normalizes paths,
and returns a deeply frozen manifest context.

## `validate(options = {})`

Loads the manifest and validates the installed adapter registry without writing
generated artifacts. It returns `{ manifest, registry }`.

## `compile(options = {})`

Validates the workspace and renders every enabled target. It returns:

```js
{
  manifest,
  targets: [{ id: "codex", files: 1 }],
}
```

Options may include `root`, `manifest`, `registry`, or `adapterDirectory`.
Supplying `registry` is the supported way to use external adapters in v0.1.

## `createAdapterRegistry(directory)`

Discovers `.mjs` adapter modules in a directory, validates their exports, and
returns a frozen adapter array.

## `validateAdapterRegistry(registry)`

Validates an adapter array for unique IDs and callable `render` functions. It
returns a frozen copy of the registry.
