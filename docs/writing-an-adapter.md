# Writing an adapter

An adapter is the only place that knows how one runtime wants its files. The
built-in Cursor adapter is about eighty lines, and that is the target: if a new
adapter needs much more, the shared layers are missing something.

Read the [adapter contract](adapter-api.md) for the full API. This is how to
build one.

## 1. Declare what you own

```js
export const id = "windsurf";

export const surface = {
  version: 1,
  artifacts: [{ id: "rules", kind: "directory", path: ".windsurf/rules" }],
};
```

The surface is metadata: the compiler validates that your paths are relative,
stay inside the project root, never write into `.ai/`, and do not collide with
another enabled adapter. Rendering still produces the actual files.

## 2. Declare what the runtime cannot do

```js
export const capabilities = {
  rules: "native",
  agents: "unsupported",
  commands: "unsupported",
  hooks: "unsupported",
};
```

This is documentation today and it drives `aie explain`. The obligation it
creates is the next step.

## 3. Render

```js
export async function render(manifest, context) {
  const directory = manifest.resolve.directory(id);

  return {
    files: manifest.sources.rules.map((rule) => ({
      path: path.join(directory, "rules", `${rule.id}.md`),
      contents: rule.body,
    })),
    diagnostics: manifest.sources.agents.map((agent) => ({
      severity: "info",
      code: "capability-unsupported",
      message: `Windsurf has no agent format, so "${agent.id}" is not generated.`,
      file: agent.relative,
    })),
  };
}
```

Three rules govern this function:

1. **Never touch the filesystem.** Return contents; the compiler writes them.
   This is what makes ownership records, collision detection, and `aie check`
   possible. An adapter that writes cannot participate in a transaction.
2. **Be deterministic.** Same manifest, same bytes, every time. No timestamps,
   no randomness, no iteration over unsorted sets.
3. **Never skip silently.** Every source your runtime cannot express gets a
   diagnostic naming it. Users must be able to tell "not supported" from
   "quietly dropped".

Use `rule.content` when the runtime consumes the file verbatim (frontmatter
included) and `rule.body` when you inline it into a larger document.

## 4. Merging into a file the user owns

If your runtime keeps configuration in a file the user also edits, declare it
with `merge: true` and the compiler pre-reads it for you:

```js
export const surface = {
  version: 1,
  artifacts: [{ id: "settings", kind: "file", path: ".windsurf/settings.json", merge: true }],
};

export async function render(manifest, context) {
  const current = context.existing[".windsurf/settings.json"];   // string or undefined
  const previouslyOwned = context.owned.merged[".windsurf/settings.json"] ?? {};
  ...
  return { files: [{ path, kind: "merge", owns: myEntries, contents }] };
}
```

Return the entries you own in `owns`; they are recorded verbatim in the
ownership record, so the next sync can tell your writes from the user's edits.
Preserve everything else exactly. The Claude adapter's `mergeSettings` is the
reference implementation.

## 5. Test it

Fixture tests belong beside the built-ins in `test/`. Cover at minimum:

- the generated file's exact shape, including any frontmatter;
- an empty source list (no dangling separators, no empty files);
- a second render producing identical output;
- one diagnostic for a source the runtime cannot express.

Add the runtime to the cross-runtime consistency test so it cannot drift from
the others.

## Shipping it

External adapters work today — no plugin system required:

```js
import { compile, validateAdapterRegistry } from "@akinlabs/ai-engineering";

await compile({ root: process.cwd(), registry: validateAdapterRegistry([myAdapter]) });
```

Adding an adapter to this package is a different decision. Each built-in is a
standing commitment to track that runtime's format as it changes, and these
formats change often. A new built-in needs a maintainer willing to own that,
plus fixture tests and an example. If nobody can commit to it, ship it as a
separate package and link it — that is a feature of the registry, not a
consolation prize.
