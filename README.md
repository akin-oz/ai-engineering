# AI Engineering OS

> Keep AI instructions in one reviewable source tree. Compile them for the coding assistants your team uses.

[![npm version](https://img.shields.io/npm/v/%40akinlabs%2Fai-engineering)](https://www.npmjs.com/package/@akinlabs/ai-engineering)
[![npm downloads](https://img.shields.io/npm/dm/%40akinlabs%2Fai-engineering)](https://www.npmjs.com/package/@akinlabs/ai-engineering)
[![CI](https://github.com/akin-oz/ai-engineering/actions/workflows/ci.yml/badge.svg)](https://github.com/akin-oz/ai-engineering/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/%40akinlabs%2Fai-engineering)](https://www.npmjs.com/package/@akinlabs/ai-engineering)
[![License](https://img.shields.io/github/license/akin-oz/ai-engineering)](LICENSE)

AI Engineering OS turns a repository's tool-agnostic .ai/ workspace into
runtime-specific artifacts. The current release supports Claude Code and Codex.

## The problem

AI coding assistants each want instructions in a different place and format.
At first, copying a few rules into CLAUDE.md, AGENTS.md, or a runtime directory
is simple. Over time, that creates duplicated instructions, configuration drift,
and reviews that must check the same policy in several files.

AI Engineering OS keeps project intent in one source tree and generates the
runtime files from it. The generated files remain visible and commit-ready,
but they are never edited by hand.

## Before and after

    Multiple hand-maintained configurations

    CLAUDE.md
    AGENTS.md
    .cursor/rules/
    ...more runtime-specific files

                             ↓

    One source of truth

    .ai/
    ├── manifest.yaml
    ├── agents/
    ├── rules/
    └── templates/

                             ↓ ai sync

    Generated runtime artifacts

    .claude/
    .codex/

## A real transformation

This repository's basic example starts with one rule:

    examples/basic/.ai/rules/concise.md

    Prefer clear, focused changes with explicit trade-offs.

The Claude adapter keeps the rule as a runtime rule file:

    examples/basic/.claude/rules/concise.md

    Prefer clear, focused changes with explicit trade-offs.

The Codex adapter combines the same rule with the example agent in AGENTS.md:

    examples/basic/.codex/AGENTS.md

    ## Rule: concise

    Prefer clear, focused changes with explicit trade-offs.

    ---

    ## Agent: reviewer

    Review changes for correctness, clarity, and maintainability.

The source intent is shared, while each adapter chooses the format that its
runtime expects.

This repository also dogfoods the compiler: its committed
[.claude/](.claude) and [.codex/](.codex) artifacts are generated from its
[.ai/](.ai) workspace.

## Why not maintain two files by hand?

That is a reasonable workflow for a small repository using one or two
assistants. This tool becomes useful when the instruction set grows, several
assistants are used by the same team, or the same standards must stay aligned
across runtime-specific formats.

The benefit is not hiding generated files. It is reviewing project intent once,
compiling deterministic outputs, and letting CI catch drift.

## Philosophy

- **Single source of truth:** .ai/ owns project intent.
- **Deterministic output:** the same source produces the same artifacts.
- **Reviewable changes:** source and generated outputs can be committed and reviewed.
- **Runtime adapters:** format-specific behavior stays outside the compiler core.
- **Tool-agnostic intent:** repositories describe engineering behavior, not vendor configuration.

## Quick start

    npm install --save-dev @akinlabs/ai-engineering
    npx ai init
    npx ai sync

ai init creates a minimal .ai/ workspace without overwriting existing files.
Add rules and agents under .ai/, then run ai sync whenever they change.

Validate without generating output:

    npx ai validate

In CI, verify that committed artifacts are current:

    npx ai sync
    git diff --exit-code

## Who is this for?

Good fit:

- teams using multiple AI coding assistants
- repositories with shared engineering standards
- projects that want AI behavior reviewed alongside source changes

Probably not necessary:

- a single-developer repository using one assistant
- a small project with only a few instructions and no duplication

## Supported runtimes

The v0.1 release supports:

- Claude Code, through .claude/
- Codex, through .codex/

Additional runtimes are planned, but the current project does not claim to
support every AI coding assistant.

## Architecture

The compiler pipeline is intentionally small:

    .ai/manifest.yaml
            ↓ load and validate
    immutable project manifest
            ↓ adapter registry
    runtime-specific rendering
            ↓
    .claude/ and .codex/

The compiler core coordinates loading, validation, and adapters. Adapters own
runtime-specific rendering. See the detailed [architecture
documentation](docs/architecture.md) and [adapter contract](docs/adapter-api.md).

The public JavaScript API is documented in [docs/api.md](docs/api.md).

## Roadmap

Near-term work will focus on diagnostics, stronger validation, and incremental
compilation. Broader runtime and context-graph work will follow only when the
core workflow has proven useful in real repositories.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull
request. Security concerns should be reported according to
[SECURITY.md](SECURITY.md).

## License

AI Engineering OS is released under the [MIT License](LICENSE).
