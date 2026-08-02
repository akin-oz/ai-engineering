# AI Engineering OS

AI Engineering OS compiles a repository's tool-agnostic `.ai/` workspace into
runtime-specific artifacts for AI coding assistants.

The `.ai/` directory is the source of truth. Generated directories such as
`.claude/` and `.codex/` are build outputs and must not be edited by hand.

## Usage

Install the compiler in a repository that contains `.ai/`:

```sh
npm install --save-dev @akinlabs/ai-engineering
```

Compile enabled runtimes:

```sh
npx ai sync
```

Validate the workspace without generating output:

```sh
npx ai validate
```

Show available commands or the installed compiler version:

```sh
npx ai --help
npx ai --version
```

CI should verify generated output is committed and current:

```sh
npx ai sync
git diff --exit-code
```

## Workspace contract

```text
.ai/
├── manifest.yaml
├── agents/
├── rules/
├── hooks/
├── commands/
└── templates/
```

The manifest declares intent and enabled runtimes, for example:

```yaml
version: 1

targets:
  claude:
    enabled: true
  codex:
    enabled: true

agents:
  - principal-architect

rules:
  - engineering
```

## Architecture

The package is divided into five boundaries:

- `manifest`: parses, validates, normalizes, and freezes project intent.
- `filesystem`: provides the small filesystem vocabulary used by adapters.
- `adapters`: contains runtime-specific rendering strategies.
- `compiler`: coordinates manifest loading, adapter selection, and execution.
- `cli`: translates user commands into public compiler operations.

The compiler core never branches on a runtime name. An adapter is discovered
from the package adapter directory and must export `id` and `render(manifest)`.
Future plugin support can provide another adapter registry through the public
`compile({ registry })` option without changing the compiler core.

See [docs/architecture.md](docs/architecture.md) for the design decisions and
the planned extension points. The stable adapter contract is documented in
[docs/adapter-api.md](docs/adapter-api.md).

The public JavaScript API is documented in
[docs/api.md](docs/api.md). A complete minimal workspace is available in
[examples/basic](examples/basic).
