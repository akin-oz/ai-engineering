# Adapter API

Adapters are the runtime-specific extension point. They own the complete
installation surface for their runtime: directories, root-level files, hooks,
metadata, manifests, and future runtime-specific assets.

An adapter module must export exactly the meaningful parts of this contract:

```js
export const id = "example";

export const surface = {
  version: 1,
  artifacts: [
    { id: "instructions", kind: "file", path: "INSTRUCTIONS.md" },
    { id: "runtime", kind: "directory", path: ".example" },
  ],
};

export async function validate(manifest) {}

export async function render(manifest) {
  // Generate every declared artifact for a complete runtime installation.
  return { files: 2, artifacts: ["instructions", "runtime"] };
}
```

`surface` and `validate` are optional during the compatibility period. Legacy
adapters that export only `id` and `render` remain valid and are treated as
owning `manifest.resolve.output(id)`. Built-in adapters must declare a complete
surface in the next release.

The compiler passes a frozen manifest object with these stable fields:

- `version`: manifest schema version.
- `root`: absolute project root.
- `sourceRoot`: absolute `.ai` path.
- `targets`: normalized target configuration.
- `agents`, `rules`: declared names in manifest order.
- `files`: absolute source and output directories.
- `resolve.agent(name)`, `resolve.rule(name)`, and `resolve.output(id)`.

Adapters must not mutate the manifest. They own every path declared by their
surface and are responsible for deterministic rendering across that complete
surface. Root-level paths must be explicit, paths must remain inside the
project root, and adapters must not read another runtime's output as input.
Adapters should render through the shared artifact transaction so a failed sync
does not leave a partial installation. See the [runtime parity plan](runtime-parity.md).

External consumers can provide a validated adapter array to:

```js
import {
  compile,
  validateAdapterRegistry,
} from "@akinlabs/ai-engineering";

const registry = validateAdapterRegistry([adapter]);
await compile({ root: process.cwd(), registry });
```

The registry should validate surface declarations, and the compiler should
reject overlapping ownership between enabled adapters before rendering. The
legacy contract remains supported while this surface contract is introduced.
