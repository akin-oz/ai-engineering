# Adapter contract

An adapter turns the normalized manifest into files for one runtime. It is the
only place runtime-specific knowledge lives.

```js
export const id = "example";

export const surface = {
  version: 1,
  artifacts: [
    { id: "root-instructions", kind: "file", path: "EXAMPLE.md" },
    { id: "agents", kind: "directory", path: ".example/agents" },
  ],
};

export const capabilities = {
  rules: "inline",
  agents: "native",
  commands: "unsupported",
  hooks: "unsupported",
};

export async function render(manifest, context) {
  return {
    files: [{ path: "EXAMPLE.md", contents: "..." }],
    diagnostics: [],
  };
}
```

A step-by-step guide is in [writing an adapter](writing-an-adapter.md).

## render(manifest, context)

Returns `{ files, remove, diagnostics }`.

- `files` — every file this target generates, as `{ path, contents }`, with
  optional `mode` (POSIX permissions) and `kind`. Paths are relative to the
  project root, must stay inside it, and must not write into `.ai/`. Two
  adapters generating the same path is an error naming both.
- `remove` — optional cleanup of artifacts an earlier release generated, as
  `{ path, proof }`. The compiler deletes the file only if the proof holds:
  `{ kind: "banner" }` requires the generated banner, `{ kind: "equals",
  contents }` requires the bytes to still match. A file that fails its proof is
  preserved and reported.
- `diagnostics` — `{ severity, code, message, file }`. Use these whenever the
  runtime cannot express a declared source. Silence is never acceptable.

**Adapters never touch the filesystem.** The compiler owns all writes, which is
what makes ownership records, collision detection, and `aie check` work. An
adapter that writes directly cannot participate in a transaction, so `render`
returning anything other than a `files` array is an error.

Rendering must be pure and deterministic: the same manifest always produces the
same bytes. Adapters must not mutate the manifest, import each other, or read
another runtime's generated output.

## context

The second argument, supplied by the compiler so adapters never read the disk:

- `context.existing[path]` — current contents of each surface artifact declared
  with `merge: true`, or `undefined` when the file does not exist.
- `context.owned.paths` — files this target generated last time.
- `context.owned.merged[path]` — the entries this target owns inside a merged
  file, recorded verbatim by the previous sync.

## Merged files

A file the user also edits is declared `merge: true` and returned with
`kind: "merge"` and an `owns` value describing the entries the adapter owns:

```js
return { files: [{ path: SETTINGS, kind: "merge", owns: entries, contents }] };
```

The adapter must preserve everything it does not own; the compiler will not
treat a merged file as a collision, because the adapter has taken
responsibility for the rest of it. Comparing `owns` against
`context.owned.merged` is how an adapter detects that a user hand-edited an
entry it generated — report that as an error rather than overwriting.

## surface

Optional, and metadata only — it declares what the adapter owns for validation
and diagnostics; `render` still produces the actual files. Declared paths are
validated for containment, duplication, and merge compatibility when the
registry loads. An adapter without a `surface` is valid, but cannot merge.

## capabilities

Optional map describing what the runtime can express (`native`, `inline`,
`settings-merge`, `unsupported`). It drives `aie explain`; the compiler does not
otherwise act on it. Declaring `unsupported` does not excuse silence — emit a
`capability-unsupported` diagnostic for each affected source.

## Manifest fields available to adapters

- `root`, `sourceRoot` — absolute paths.
- `agents`, `rules`, `commands` — declared names in order.
- `sources.agents`, `sources.rules`, `sources.commands` — `{ id, file,
  relative, content, body, metadata }` for each declared source, already read.
  `content` is the file verbatim; `body` has frontmatter removed; `metadata` is
  the parsed frontmatter.
- `sources.hooks` — `{ id, event, name, relative, content, mode }` for each
  declared hook. Events are `pre-edit`, `post-edit`, `session-start`, and
  `session-end`.
- `workflow` — present only for blueprint workspaces: the workflow name, the
  pack that produced the sources, and what it contributed.
- `resolve.directory(id)` — the target's output directory, relative to root.
- `resolve.output(id)` — the same directory, absolute.
- `files` — resolved source directories.

## Using an external adapter

```js
import { compile, validateAdapterRegistry } from "@akinlabs/ai-engineering";

const registry = validateAdapterRegistry([myAdapter]);
await compile({ root: process.cwd(), registry });
```
