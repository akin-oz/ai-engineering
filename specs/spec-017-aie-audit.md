# Spec 017: `aie audit`

- Status: **Shipped in 0.4.0**
- Priority: P1
- Target release: 0.4.0
- Depends on: Spec 012 (check, CI action), Spec 015 (hook), Spec 016 (permissions)
- Finding: `aie check` proves the generated files match their source. Nothing
  proves the source describes a defended repository. A workspace can compile
  cleanly to a `settings.json` that denies nothing, runs no sandbox,
  auto-approves every MCP server in the repository, and installs a commit guard
  that `git -C . commit` walks past.

## Problem

Each layer of an agent's configuration has a failure mode that is invisible
until it matters, and each is cheap to detect statically:

- an empty `permissions.deny` — the model is asked, never refused;
- the Bash sandbox off — `Edit` rules stop the edit tools, not `sed -i`;
- `enableAllProjectMcpServers: true` — a server added to `.mcp.json` in a pull
  request runs, outside the sandbox, without anyone approving it;
- a `.env` or private key on disk that no `Read` deny rule covers;
- git hooks that `--no-verify` skips, with nothing denying it;
- a guard hook that matches `"git commit"` as a substring (the 0.3.0 bug);
- a fail-open guard hook whose guarantee no CI job re-checks.

## Command

```
aie audit [--json] [--strict]
```

Audits the repository's **committed Claude Code project configuration**:
`.claude/settings.json`, the hook scripts it runs, the files present under the
project root, and `.github/workflows/`. It does not need an `.ai/` workspace —
like `check`, it is useful to a repository that does not compile anything.

It does not read `.claude/settings.local.json` (personal, uncommitted, absent
in CI), user or managed settings, or the contents of any secret file: it looks
at file names only.

### Exit codes

Same contract as `check`:

| Code | Meaning |
| --- | --- |
| 0 | no findings at error severity (or none at all with `--strict`) |
| 1 | at least one error finding, or any finding with `--strict` |
| 2 | the repository cannot be audited: `settings.json` is not valid JSON |

### Findings

Every finding has a stable `code`, a `severity`, a `message`, the `file` it is
about when there is one, and a `fix` hint. Findings are sorted by code, then
file, so output is deterministic. `--json` prints
`{ ok, command: "audit", findings }`.

| Code | Severity | Fires when | Fix hint |
| --- | --- | --- | --- |
| `deny-empty` | warning | `permissions.deny` is absent or empty | declare deny rules, starting with secrets |
| `sandbox-disabled` | warning | `sandbox.enabled` is not `true` | enable the sandbox; `Edit` rules do not stop shell writes |
| `mcp-auto-approve` | error | `enableAllProjectMcpServers` is `true` | remove it; list trusted servers in `enabledMcpjsonServers` |
| `secret-readable` | error | a file named `.env`, `.env.*`, `*.pem`, or `*.key` exists under the root and no `Read` deny rule covers it | add `Read(./<path>)` or a pattern covering it |
| `no-verify-unblocked` | warning | the repository has git hooks (`.husky/`, `.githooks/`, `.pre-commit-config.yaml`, `lefthook.yml`, or a non-sample script in `.git/hooks/`) and no `Bash` deny rule matches `git commit --no-verify` and `git push --no-verify` | add deny rules, and back the hooks with CI |
| `hook-pattern-git-global-options` | error | a hook script run from `settings.json` matches git commands as a substring (`*"git commit"*`, `grep 'git push'`) | parse the command; `git -C dir commit` does not contain `git commit` |
| `hook-no-ci-backstop` | warning | `settings.json` runs a guard hook this compiler ships (`spec-trailer.sh`) and no workflow under `.github/workflows/` runs its CI check | add the CI check from the hook's rule |

Not flagged: `.env.example`, `.env.sample`, `.env.template`, and `.env.dist`
are templates by convention. Directories `node_modules` and `.git` are not
walked.

### How a `Read` rule is matched

The audit matches the documented rule forms and errs toward reporting:

- `Read` alone denies every read.
- `Read(./path)` and `Read(path/with/slash)` are anchored at the project root.
- `Read(name)` without a slash matches that name at any depth, as
  `Read(**/name)` does (gitignore semantics).
- `*` matches within a path segment, `**` across segments, `?` one character.
- Rules anchored elsewhere (`//abs`, `~/…`) are not treated as covering a
  repository file. A rule the audit cannot interpret counts as not covering,
  so the worst case is a false report with a fix, never a false all-clear.

`Bash` deny rules are matched as Claude Code documents them: `Bash(cmd:*)` as
a prefix, `*` as a wildcard, otherwise exact.

### Why the guard-specific rules are narrow

`hook-no-ci-backstop` knows one guard, the one this compiler ships, because it
knows that guard's CI check (`%(trailers:key=Spec)`). A rule that claimed to
judge arbitrary hooks would be guessing. The same goes for
`hook-pattern-git-global-options`: it flags the specific substring patterns
that shipped broken in 0.3.0, not every way a script can be wrong.

## Where the code lives

`src/audit/` — a runner that collects a snapshot of the repository (settings,
file names, hook scripts, workflow texts) and pure rule functions over that
snapshot. Not in `src/compiler/` (audit compiles nothing) and not in the Claude
adapter: adapters are pure functions of the manifest by contract, and the audit
reads the repository. The rules are Claude Code rules and are named that way
(`src/audit/claude.mjs`); a second runtime's rules would be a second module.

## GitHub Action

The action gains an `audit` input:

| Value | Behavior |
| --- | --- |
| `warn` (default) | run `aie audit --json`, annotate each finding as a warning, add a table to the job summary, never fail the job |
| `fail` | the same, annotating error findings as errors, and failing the job by the audit's exit code (respecting `strict`) |
| `off` | do not run the audit |

`warn` is the default because the action is consumed through the floating `v0`
tag: making new findings fail existing pipelines would be a breaking change
shipped to everyone at once.

## Tests

`test/audit.test.mjs`, through the CLI against temporary repositories:

- each code has one test where it fires and one where it stays quiet;
- exit codes 0, 1, 2, and `--strict` turning a warning into 1;
- `--json` output is identical across two runs;
- the 0.3.0 `spec-trailer.sh` (substring patterns) fires
  `hook-pattern-git-global-options`; the 0.3.1 script stays quiet;
- a `.env` file's contents are never read (the test makes it unreadable).

`test/action.test.mjs` runs `scripts/github-check.mjs` for `warn`, `fail`, and
`off`, asserting on exit codes and the `::warning`/`::error` annotation lines,
which are the action's interface.

## Done when

- The tests pass on Node 20, 22, and 24.
- README and `docs/` describe `aie audit` and the action input.
- `CHANGELOG.md` 0.4.0 lists it.
