# AI Engineering Compiler

> Keep AI assistant instructions in one reviewable source tree. Compile them for
> Claude Code and Codex.

[![npm version](https://img.shields.io/npm/v/%40akinlabs%2Fai-engineering)](https://www.npmjs.com/package/@akinlabs/ai-engineering)
[![npm downloads](https://img.shields.io/npm/dm/%40akinlabs%2Fai-engineering)](https://www.npmjs.com/package/@akinlabs/ai-engineering)
[![CI](https://github.com/akin-oz/ai-engineering/actions/workflows/ci.yml/badge.svg)](https://github.com/akin-oz/ai-engineering/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/%40akinlabs%2Fai-engineering)](https://www.npmjs.com/package/@akinlabs/ai-engineering)
[![License](https://img.shields.io/github/license/akin-oz/ai-engineering)](LICENSE)

## The problem

AI coding assistants each want instructions in a different place and format.
Copying a few rules into `CLAUDE.md` and `AGENTS.md` is simple at first. It stops
being simple when the same policy lives in five generated places, because the
failure is quiet: someone tightens a rule in one file, nothing errors, and the
assistants start giving different advice depending on which one you opened.

This compiler keeps project intent in `.ai/` and generates the runtime files
from it. Generated files stay visible and commit-ready — they are just never
edited by hand.

**Most repositories do not need this.** If one prose file covers your
instructions, symlink `CLAUDE.md` to `AGENTS.md` and stop there. See
[docs/comparison.md](docs/comparison.md) for honest comparisons against
symlinks, the AGENTS.md standard, rulesync, and doing nothing.

## Quick start

```sh
npm install --save-dev @akinlabs/ai-engineering
npx aie init
npx aie sync
```

`aie init` creates a `.ai/` workspace with a starter rule, without overwriting
anything. `aie sync` compiles it:

    .ai/                              CLAUDE.md
    ├── manifest.yaml       ──►       AGENTS.md
    ├── rules/                        .claude/agents/
    ├── agents/                       .claude/commands/
    └── commands/

Both runtimes load their instructions from the repository root, so `CLAUDE.md`
and `AGENTS.md` are the files that actually get read.

In CI, fail the build when generated files drift from their source:

```sh
npx aie check
```

## It will not overwrite your work

`aie sync` may only delete or replace a file it can prove it generated: one
listed in its ownership record (`.ai/state/targets/`), one whose bytes still
match the source it was copied from, or one carrying the generated banner.

Anything else is reported and the sync stops before writing:

    Refusing to overwrite files this workspace does not own:

      CLAUDE.md (claude)

    Move them aside, or run with --force to overwrite them and take ownership.

Your existing `.claude/settings.json` and hand-written commands survive every
sync. Nothing is skipped silently either — a source a runtime cannot express
produces a diagnostic naming it, on every run.

## Already have CLAUDE.md and AGENTS.md?

Import them instead of starting over:

```sh
npx aie adopt
```

Adopt is a dry run by default. It splits your existing instruction files into
`.ai/` sources, flags pairs that look like the same policy written twice, and
never modifies the originals. `--write` applies the plan. See
[examples/adopt-existing](examples/adopt-existing) for the walkthrough.

## Commands

| Command | Behavior | Exit codes |
| --- | --- | --- |
| `aie init` | Create a `.ai` workspace with a starter rule | 0 |
| `aie adopt` | Import existing assistant files (dry run by default) | 0 |
| `aie sync` | Compile enabled targets | 0, 1 on failure |
| `aie check` | Report drift without writing | 0 clean, 1 drift, 2 broken workspace |
| `aie validate` | Validate the workspace without comparing output | 0, 1 on failure |
| `aie explain` | Show what a workflow contributed and where it lands | 0 |

Options: `--strict` (warnings become errors), `--force` (overwrite unowned
files), `--write` (apply an adoption), `--blueprint`, `--dry-run`, `--json`.

## In CI

```yaml
- uses: akin-oz/ai-engineering@v0
```

The action runs `aie check`, annotates the drifted files on the pull request,
and fails the job. It writes nothing.

## Supported runtimes

| Runtime | Rules | Agents | Commands | Hooks |
| --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` | `.claude/agents/` | `.claude/commands/` | `.claude/hooks/` + `settings.json` |
| Codex | `AGENTS.md` | inlined | — | — |
| Cursor | `.cursor/rules/*.mdc` | — | — | — |

A dash means the runtime has no format for it. The compiler says so on every
run rather than dropping the source silently.

Hooks are declared with a normalized event — `pre-edit`, `post-edit`,
`pre-tool`, `post-tool`, `session-start`, `session-end`, `turn-end` — and wired
into `.claude/settings.json`. The `-tool` events name the tools they fire for
(`tools: [Bash]`); the rest do not take one. The compiler owns only the entries
it wrote there and preserves the rest of your settings; see
[what the compiler owns in a shared settings file](docs/architecture.md#what-the-compiler-owns-in-a-shared-settings-file).

## Compiling a workflow instead of listing files

`aie init --blueprint` writes a `.ai/blueprint.yaml` that names an engineering
workflow rather than individual files:

```yaml
schema: 2
project:
  type: library
workflow:
  development: spec-driven
ai:
  runtimes: [claude, codex]
```

`aie sync` composes that workflow into `.ai/generated/` — agents, rules,
commands, templates, and hooks, committed and reviewable — then compiles it for
each runtime. `aie explain` shows what came from where. Your own rules, agents,
commands, and hooks compile alongside the pack's, and an id declared in both
places is an error rather than a silent override.

A blueprint takes a `hooks:` block exactly like a manifest does. Adopting a
workflow is not all or nothing either — drop a single contribution by name:

```yaml
workflow:
  development: spec-driven
  disable: [hook.spec-trailer]
```

Naming something the pack does not contribute is an error, so a typo cannot
look like it worked.

One workflow ships today (`spec-driven`). More arrive when this one has proven
useful in real repositories, not before.

## Examples

- [examples/basic](examples/basic) — smallest complete workspace
- [examples/typescript-library](examples/typescript-library) — the case where
  hand-maintenance actually fails
- [examples/adopt-existing](examples/adopt-existing) — a repository already
  carrying drifted instruction files, and how to import it

This repository compiles itself: [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md)
are generated from [.ai/](.ai), and CI fails if they drift or if any source file
is empty.

## Documentation

- [docs/](docs) — shipped behavior: [architecture](docs/architecture.md),
  [public API](docs/api.md), [adapter contract](docs/adapter-api.md),
  [writing an adapter](docs/writing-an-adapter.md),
  [comparisons](docs/comparison.md)
- [specs/](specs) — scoped work that is committed but not finished
- [rfcs/](rfcs) — design that may never be built

That split is deliberate: 0.1 documented features that did not exist, which made
the real claims harder to trust.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Report security concerns per
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
