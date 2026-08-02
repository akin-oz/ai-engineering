# Adapter API

Adapters are the only runtime-specific extension point in v0.1.

An adapter module must export exactly the meaningful parts of this contract:

```js
export const id = "example";

export async function render(manifest) {
  // Generate only the adapter's output under manifest.resolve.output(id).
  return { files: 1 };
}
```

The compiler passes a frozen manifest object with these stable fields:

- `version`: manifest schema version.
- `root`: absolute project root.
- `sourceRoot`: absolute `.ai` path.
- `targets`: normalized target configuration.
- `agents`, `rules`: declared names in manifest order.
- `files`: absolute source and output directories.
- `resolve.agent(name)`, `resolve.rule(name)`, and `resolve.output(id)`.

Adapters must not mutate the manifest. They own their output directory and are
responsible for deterministic rendering within it. They must not read another
runtime's output as input.

External consumers can provide a validated adapter array to:

```js
import {
  compile,
  validateAdapterRegistry,
} from "@akinlabs/ai-engineering";

const registry = validateAdapterRegistry([adapter]);
await compile({ root: process.cwd(), registry });
```

This is intentionally a small v0.1 contract. Plugin discovery, lifecycle
hooks, declared input scopes, output ownership metadata, and versioned adapter
capabilities should be added only when their semantics are designed and tested
as a compatibility surface.
