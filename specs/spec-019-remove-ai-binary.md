# Spec 019: Remove the deprecated `ai` binary

- Status: **In progress**
- Priority: P3
- Target release: 0.4.0
- Depends on: —
- Finding: 0.2.0 renamed the command to `aie` and kept `ai` as a deprecated
  alias. The alias prints "will be removed in 0.4.0", and the 0.3.1 release
  note repeats the promise. A deprecation that never lands teaches users to
  ignore the next one.

## Change

- Delete `bin/ai.mjs` and the `ai` entry in `package.json` `bin`.
- An installed 0.4.0 package provides `aie` only. `npx ai …` in a project that
  has upgraded no longer resolves to this package (and must not be suggested:
  `ai` on npm is an unrelated package).
- The packed-install CI job asserts that no `ai` executable is installed.
- The pull request template and the repository's run skill name `aie`.

Historical release notes and RFCs keep their `ai` examples; they describe the
past and are not instructions.

## Migration

Replace `ai` with `aie` in scripts, CI configuration, and documentation. The
arguments, flags, and exit codes are identical; only the command name changes.

## Tests

`test/package-smoke.test.mjs` asserts that `bin` contains exactly `aie` and
that `bin/ai.mjs` does not exist. It fails before the change.

## Done when

- Tests pass on Node 20, 22, and 24, and the packed-install CI job passes.
- `CHANGELOG.md` 0.4.0 has a "Removed" entry with the migration step.
