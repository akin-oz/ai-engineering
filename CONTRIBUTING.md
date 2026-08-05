# Contributing

## Development

Requirements: Node.js 20 or newer, and npm.

```sh
npm ci
npm test
npm run check
```

Before opening a pull request:

```sh
node bin/aie.mjs check --strict
node scripts/verify-dogfood.mjs . examples/*/
```

`aie check` reports whether the committed generated files still match their
source; run `aie sync` if they do not.

## Ground rules

**Never delete or overwrite a file the compiler cannot prove it created.** A
file may be removed only when an ownership record lists it, when its bytes still
match the source it was copied from, or when it carries the generated banner.
Changes that add a fourth exception will not be merged.

**Keep `.ai/` as the source of truth.** Do not edit generated artifacts by hand;
regenerate them.

**Runtime-specific behavior belongs in an adapter.** Adapters are pure: they
return file contents and never touch the filesystem, import each other, or read
another runtime's output.

**Nothing is skipped silently.** An input that is ignored or unsupported must
produce a diagnostic with a stable code.

## Tests

Changes to behavior need a case in `test/e2e.test.mjs`, which drives the real
CLI against a temporary repository. Unit tests on hand-built manifests missed
every failure that shipped in 0.1 — a sync that deleted user files, output in a
location no runtime reads, and a golden path that compiled to nothing while
reporting success.

Every diagnostic code needs both a test proving it fires and one proving it
stays quiet.

## Documentation

`docs/` describes shipped behavior only. Scoped work in progress goes in
`specs/`; design that may never be built goes in `rfcs/`. Changes to the public
API, manifest format, or adapter contract need documentation, tests, and a
changelog entry in the same pull request.
