---
name: run-ai-engineering-compiler
description: Run, build, test, and smoke-check the ai-engineering compiler CLI (aie). Use to compile a .ai workspace, verify the aie init/sync/check/validate commands, check exit codes and generated CLAUDE.md/AGENTS.md, or confirm a change to the compiler still works end-to-end.
---

# Run the ai-engineering compiler

This unit is a **Node CLI**, not a GUI or server. The "app" is
`bin/aie.mjs`: it reads a `.ai/` workspace and compiles runtime files
(`CLAUDE.md`, `AGENTS.md`, `.claude/…`). The way to drive it is the
smoke driver at
[`.claude/skills/run-ai-engineering-compiler/smoke.mjs`](smoke.mjs),
which runs every command in a throwaway workspace and asserts on the
contract that matters here: **exit codes and generated files**.

All paths below are relative to the repo root (`<unit>/`).

## Prerequisites

- Node **≥ 20** (developed on 26). No `apt-get`, no build step, no
  native modules — the only runtime dependency is `yaml`.

```bash
npm ci   # or: npm install
```

## Run (agent path) — the smoke driver

This is the primary way to confirm the compiler works. It needs no
arguments and cleans up after itself (each phase runs in an OS temp
dir).

```bash
node .claude/skills/run-ai-engineering-compiler/smoke.mjs
```

Exit `0` = all assertions passed; exit `1` = at least one failed, with
the failing line marked `FAIL`. It covers:

- **meta** — `--version` (semver), `--help`, unknown command → exit 1,
  unknown option → exit 1.
- **lifecycle** — `init` → `validate` → `check` (exit 1, out of date)
  → `sync` (writes `CLAUDE.md` + `AGENTS.md`) → `check` (exit 0).
- **determinism** — two syncs produce a byte-identical tree.
- **ownership guard** — a hand-written `CLAUDE.md` is *not* overwritten:
  `sync` exits 1 ("Refusing to overwrite"), `check` exits 2, the file
  is left byte-for-byte intact.

## Direct invocation — drive the CLI yourself

The commands, run against any directory (defaults to cwd):

```bash
node bin/aie.mjs --version        # prints e.g. 0.2.0
node bin/aie.mjs init             # scaffold a .ai/ workspace
node bin/aie.mjs validate         # validate .ai/ without comparing output
node bin/aie.mjs check            # exit 1 if generated files are stale
node bin/aie.mjs sync             # compile; writes CLAUDE.md, AGENTS.md, .claude/
node bin/aie.mjs sync --dry-run   # report what sync would change, write nothing
node bin/aie.mjs sync --json      # machine-readable output (all commands accept --json)
```

To watch a full compile end to end in a scratch dir:

```bash
d=$(mktemp -d); ( cd "$d" && node "$OLDPWD/bin/aie.mjs" init && node "$OLDPWD/bin/aie.mjs" sync ); rm -rf "$d"
```

**Exit codes are the contract:** `0` success · `1` failure, or (for
`check`) generated artifacts are out of date · `2` the workspace could
not be compiled (e.g. an output collision).

## Test

```bash
npm test                              # node --test — 79 tests, ~2s
npm run check                         # syntax-check the entrypoints
node scripts/verify-dogfood.mjs .     # this repo's own .ai/ must compile to something
```

## Gotchas

- **`sync` on the starter workspace writes only `CLAUDE.md` and
  `AGENTS.md` — no `.claude/` files.** `aie init` scaffolds a rule but
  no agents or commands, and the `.claude/` sub-files (`agents/`,
  `commands/`) are only emitted when the manifest lists them. An empty
  `.claude/` tree after `sync` is correct, not a bug.
- **`sync` writes into `.ai/state/`, so it is *not* read-only.** Beyond
  the runtime files it records ownership under
  `.ai/state/targets/*.json`. That's how `check` later knows which
  files it may touch. Don't hand-edit or delete that dir between
  `sync` and `check`.
- **Overwrite refusal is exit 1 on `sync`, but exit 2 on `check`.**
  Same collision, different code: `sync` treats it as a failure to act,
  `check` treats it as a workspace that cannot be compiled. The driver
  asserts both — don't "fix" one to match the other.
- **Deprecated `bin/ai.mjs` still exists.** It's identical to `aie` but
  prints a deprecation warning to stderr and is removed in 0.3.0. Drive
  `aie`, not `ai`.
- **`aie` with no command defaults to `sync`**, not help. `node
  bin/aie.mjs` alone will attempt a compile of the current directory.

## Troubleshooting

- **`Error: ... no such file or directory, open '.../.ai/manifest.yaml'`**
  — you ran `sync`/`check`/`validate` in a directory that was never
  `init`-ed. Run `aie init` first, or `cd` into a workspace that has a
  `.ai/`.
- **`check` exits 1 and says "out of date"** — this is expected before
  the first `sync`, and after editing any `.ai/` source. Run `aie sync`
  to regenerate.
- **`zoxide: detected a possible configuration issue`** on every
  command — noise from the host shell's `~/.zshrc`, unrelated to this
  tool. Silence it with `export _ZO_DOCTOR=0`.
