# Threat model

What each layer of a compiled agent configuration stops, what it does not, and
where it can be walked around. The threat is the coding agent itself: a model
that, through error or injected instructions, does something the repository's
policy forbids. Repository maintainers and CI are trusted.

No single layer here is a boundary on its own. The design is that each layer
covers a gap in the one before, and that CI — which reads what actually landed —
is the last word.

Claims about Claude Code cite its documentation. Claims about this compiler
cite the test that demonstrates them.

## Rules — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`

**Stops:** nothing by itself. Rules are instructions the model reads.

**What the compiler guarantees:** the same rule text reaches every runtime the
repository targets, and drift between `.ai/` and the generated files fails
`aie check` (`test/e2e.test.mjs`). A rule a runtime cannot express produces a
diagnostic rather than disappearing (`capability-unsupported`).

**Does not stop:** a model that ignores, misreads, or is talked out of an
instruction. Anything that must hold belongs in a layer below.

## Permissions — `.claude/settings.json`

**Stops:** Claude Code refuses a tool call matching a `permissions.deny` rule.
Rules evaluate deny, then ask, then allow; the first match decides
([permissions](https://code.claude.com/docs/en/permissions)). `Edit` rules
apply to every built-in file-editing tool, and Claude Code also checks the
target of a shell redirect (`> file`, `tee`) against them. Deny rules from a
repository's settings apply immediately; its allow rules wait for workspace
trust ([settings](https://code.claude.com/docs/en/settings)).

**What the compiler guarantees:**

- Declared `allow`/`deny` rules merge into the file without overwriting or
  claiming entries you wrote, and a hand edit to an entry it owns stops the
  sync (`settings-entry-modified`, `settings-value-conflict` —
  `test/permissions.test.mjs`).
- A rule in both lists is denied (`permission-conflict`).
- Codex and Cursor cannot express permission rules, and every sync says so as
  a warning (`permissions-unsupported`), so `--strict` fails rather than
  letting a policy hold in one tool and not another. A target can accept the
  gap once someone has decided to live with it: the diagnostic still prints on
  every run, as info, and an acceptance nothing reports any more warns as
  `accept-unused` (`test/accept.test.mjs`).
- `security: hardened` denies reads of exactly the files `aie audit` reports
  as `secret-readable` and turns the sandbox on, in one line
  (`test/security.test.mjs`). It is a starting point, not a boundary of its
  own: a secret under any other name needs its own rule.
- The `spec-driven` pack's `protect-guardrails` group denies edits to
  `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/**`,
  and `.ai/generated/**`, so the session a hook guards cannot edit the hook,
  the entry that runs it, or a local `disableAllHooks` (`test/workflow.test.mjs`).

**Does not stop:**

- Shell commands that write without a redirect — `sed -i`, `cp`, an
  interpreter. `Edit` rules do not see them; only the sandbox does.
- `Bash` rules are string patterns. `Bash(git commit --no-verify:*)` does not
  match `git commit -n` or `git -c core.hooksPath=/dev/null commit`.
- Anything in a runtime that has no permission system the compiler can write
  to (Codex, Cursor).

**Known limits:** `aie audit` reads only the committed project file. User,
local, and managed settings can make the effective policy stronger or weaker
than what the repository shows.

## Hooks — `spec-trailer`

**Stops:** a `PreToolUse` hook that exits 2 blocks the tool call before
permission rules are evaluated
([hooks](https://code.claude.com/docs/en/hooks)). The `spec-driven` pack's
`spec-trailer` hook refuses a `git commit` whose message has no `Spec:` git
trailer. It reads the command the way a shell does — after git's global
options, inside `$(…)` and `${…}`, behind `env`, `xargs`, `sh -c`, and `eval`
— and asks `git interpret-trailers` whether the trailer is there. A message it
cannot read without running something is refused
(`test/adversarial.test.mjs`).

**Does not stop:**

- Commits it cannot see: a git alias (`git ci`), a script or `Makefile` target
  that commits, a commit made outside Claude Code.
- A command that only mentions git, such as `echo git commit`, is refused: a
  false positive, accepted over a false negative.

**Known limits:**

- **Hooks fail open.** Any exit other than 2, and any timeout, lets the call
  proceed ([hooks](https://code.claude.com/docs/en/hooks)). This hook also
  allows the commit when node or git is missing or the payload is malformed,
  by design: a hook bug must never be the reason someone cannot commit. Its
  parser refuses input nested deep enough to crash it, so a command cannot
  reach the fail-open path on purpose (`test/adversarial.test.mjs`).
- **String analysis is bypassable.** However careful, the hook analyzes text
  that a shell will interpret. It narrows the gap; CI closes it.
- **Hooks run outside the sandbox**, with your user's full filesystem and
  network access ([hooks](https://code.claude.com/docs/en/hooks)). A hook
  script is code you are trusting, not a constraint on the agent.
- `disableAllHooks: true` in a settings file turns every hook off. The
  `protect-guardrails` deny rules stop Claude's edit tools from setting it in
  the repository's settings files. A shell command is stopped only when the
  sandbox is on, whose protected paths include those files.

## Sandbox — `sandbox` in `.claude/settings.json`

**Stops:** the operating system confines Bash, PowerShell, and Monitor
commands, and every process they start, to the filesystem and network access
the settings allow
([sandboxing](https://code.claude.com/docs/en/sandboxing)). Inside the
sandbox, writes to Claude Code's own configuration — `.claude` settings files,
`.claude/hooks/`, `.mcp.json` — are denied regardless of other settings. `Read`
deny rules and `Edit` rules from permissions are merged into the sandbox's
filesystem policy, so with the sandbox on they bind shell commands too.

**What the compiler guarantees:** a declared `sandbox` block merges into
settings under the same ownership rules as permissions, unknown keys warn
(`sandbox-unknown-key`), and Codex and Cursor report that they cannot express
it (`sandbox-unsupported`), which a target can accept the same way as a
permissions gap. Packs never turn the sandbox on — that changes what every
command can reach, and it is the repository's decision.

**What it costs:** the sandbox's protected paths are not limited to settings.
They include `.claude/agents/`, `.claude/commands/`, `.claude/skills/`, and
`.git/config` and `.git/hooks`
([sandboxing](https://code.claude.com/docs/en/sandboxing)), and the network
starts with no allowed hosts. In this repository, with the sandbox on, that
means `git fetch` and `git push` to GitHub over SSH are refused,
`git worktree add` fails because checking out the tree writes
`.claude/agents/` files, and a commit signed through an SSH agent's socket
fails because the socket is not reachable (`network.allowUnixSockets`). Each of those needs an unsandboxed retry that a person
approves. That is the protection working, and it is also how approval fatigue
starts: a sandbox that routinely blocks normal work teaches people to approve
retries without reading them. Pre-allow the hosts a repository really needs
(`network.allowedDomains`) rather than approving the same retry every day.

**Does not stop:**

- Claude's built-in file and web tools, MCP servers, and hooks. They run
  outside the sandbox ([sandboxing](https://code.claude.com/docs/en/sandboxing)).
- Commands matching `excludedCommands`, which run unsandboxed.
- A command retried outside the sandbox through the unsandboxed-retry escape
  hatch, unless `allowUnsandboxedCommands` is `false`.

**Known limits:** the sandbox is off by default. If it cannot start, Claude
Code runs commands unsandboxed unless `failIfUnavailable` is `true`. Native
Windows has no sandbox. `aie audit` reports a disabled sandbox
(`sandbox-disabled`) but cannot see whether it actually started on a given
machine.

A repository's sandbox settings are not the effective policy. Narrowing
entries (`Read` deny rules, `denyRead`) always apply, but widening ones can be
ignored: when `network.strictAllowlist` is set in a developer's user settings,
managed settings, or `--settings`, Claude Code ignores the repository's
`allowedDomains`, and an admin-required sandbox ignores those and other
loosening keys
([sandboxing](https://code.claude.com/docs/en/sandboxing#locks-that-apply-without-an-admin-required-sandbox)).
That is the right direction for a lock to fail, but it means a host the
repository allows may still be refused on one developer's machine, and the
compiled `.claude/settings.json` cannot show it. `aie audit` reads only the
repository's file, so it cannot see this either.

**In this repository:** `.ai/manifest.yaml` uses `security: hardened`, which
enables the sandbox and denies reads of `.env`, `.env.*`, `*.pem`, and `*.key`; the Codex target accepts both
gaps, so CI stays on `--strict`, and `aie audit` reports no findings. It keeps
the defaults for `allowUnsandboxedCommands` (retries allowed, with approval)
and `failIfUnavailable` (unsandboxed if the sandbox cannot start).

It pre-allows only `api.github.com`, which `gh` needs. On a machine whose user
settings set `strictAllowlist`, as the maintainer's do, that entry is ignored
and `gh` is refused inside the sandbox until the developer allows the host in
their own settings. Git uses an SSH remote
whose key lives in an agent the sandbox cannot reach, so a sandboxed command
cannot fetch, push, or sign: each of those needs an approved unsandboxed retry
and then the agent's own confirmation. Allowing `api.github.com` is still a
widening: a sandboxed command holding any GitHub token, including one planted
in a file or a prompt, can create a gist or write to a repository through the
API. The `Read` deny rules are what keep the obvious secrets out of reach.

## MCP servers

Not compiled. `enableAllProjectMcpServers: true` approves any server added to
`.mcp.json` — including one added in a pull request — and that server runs
outside the sandbox. `aie audit` reports it as an error (`mcp-auto-approve`).

## CI — `aie check`, `aie audit`, the trailer check

**Stops:** CI reads what actually landed, so it is the one layer an agent
session cannot talk around.

- `aie check` fails when generated files drift from `.ai/`.
- `aie audit` reports gaps in the committed configuration, each with a fix
  (`test/audit.test.mjs`). The GitHub Action runs it; `audit: fail` fails the
  job on findings (`test/action.test.mjs`).
- The `spec-trailer` rule's CI snippet fails a pull request in which any commit
  lacks a `Spec:` git trailer, and fails when `git log` itself fails
  (`test/trailer-ci.test.mjs`). `aie audit` reports the hook running without it
  (`hook-no-ci-backstop`).

**Does not stop:** anything that happens on a developer's machine before a
push — reading a secret, running a command. CI catches the commit, not the
session.

**Known limits:** a check only holds if it is required. The compiler cannot
mark a GitHub check as required; branch protection does that. The action's
`audit` input defaults to `warn`, which annotates and never fails.

## Attacks, and what stops each

Each row is either a test in this repository or a citation above.

| Attempt | Stopped by | Evidence |
| --- | --- | --- |
| `git -C dir commit -m "x"` without a trailer | hook | `test/adversarial.test.mjs` |
| `git commit -m "Handle --amend"` (option name inside the message) | hook | `test/adversarial.test.mjs` |
| `Spec:` in the subject line or a shell comment | hook | `test/adversarial.test.mjs` |
| `${X:-$(git commit -m x)}`, `bash -o pipefail -c '…'` | hook | `test/adversarial.test.mjs` |
| message in a variable, a pipe, or an unquoted here-document | hook (refused as unreadable) | `test/adversarial.test.mjs` |
| `git ci -m x` through a git alias | CI trailer check | `test/trailer-ci.test.mjs` |
| a commit with `Spec:` only in prose | CI trailer check | `test/trailer-ci.test.mjs` |
| edit `.claude/hooks/spec-trailer.sh` with the edit tool | permissions (`protect-guardrails`) | `test/workflow.test.mjs` |
| set `disableAllHooks` in `.claude/settings.local.json` with the edit tool | permissions (`protect-guardrails`) | `test/workflow.test.mjs` |
| `sed -i` on `.claude/settings.json` | sandbox protected paths, when the sandbox is on (it is in this repository); otherwise the permission prompt only | [sandboxing](https://code.claude.com/docs/en/sandboxing) |
| write instructions into `.claude/agents/` or `.git/hooks/` from a shell | sandbox protected paths, when the sandbox is on; otherwise the permission prompt only | [sandboxing](https://code.claude.com/docs/en/sandboxing) |
| read `.env` with the Read tool | permissions, when a `Read` deny rule covers it; `aie audit` reports when none does | `test/audit.test.mjs` |
| `cat .env` in a shell | sandbox, when on and a `Read` deny rule covers it (both are true in this repository); otherwise nothing | [sandboxing](https://code.claude.com/docs/en/sandboxing) |
| push to an arbitrary host from a shell | sandbox network proxy, when on: no host is allowed until someone approves it | [sandboxing](https://code.claude.com/docs/en/sandboxing) |
| `git push` from a shell in this repository | sandbox: the SSH agent is unreachable and `github.com` is not allowed, so it needs an approved unsandboxed retry and an agent confirmation | [sandboxing](https://code.claude.com/docs/en/sandboxing) |
| write to someone else's repository or a gist through GitHub's API, with a token the command holds | not stopped in this repository: `api.github.com` is pre-allowed; `Read` deny rules keep the obvious secrets from being read first | [sandboxing](https://code.claude.com/docs/en/sandboxing) |
| add a server to `.mcp.json` under `enableAllProjectMcpServers` | `aie audit` (`mcp-auto-approve`), in CI | `test/audit.test.mjs` |
| hand-remove a compiled deny rule | `aie sync` refuses (`settings-entry-modified`) | `test/permissions.test.mjs` |
| a deny rule that Codex silently ignores | `--strict` fails (`permissions-unsupported`) | `test/permissions.test.mjs` |
| a hook that matches `"git commit"` as a substring | `aie audit` (`hook-pattern-git-global-options`) | `test/audit.test.mjs` |
