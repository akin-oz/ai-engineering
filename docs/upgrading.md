# Upgrading

How a project already using `@akinlabs/ai-engineering` picks up what changed
since 0.2.0. Every step here is true of the current release; the
[changelog](../CHANGELOG.md) has the full history.

```sh
npm install --save-dev @akinlabs/ai-engineering@latest
npx aie sync
```

Commit what `aie sync` changes. Then read the sections that apply to you.

## Everyone

**`ai` is now `aie`.** The `ai` command was removed in 0.4.0. Replace it in
scripts, CI, and documentation; arguments, flags, and exit codes are
unchanged. Do not switch to `npx ai`: on npm, `ai` is an unrelated package.

A workspace that declares no permissions, sandbox, or preset compiles exactly
as it did before. Nothing below happens unless you opt in or use a blueprint.

## Turn on the hardened setup

Add one line to `.ai/manifest.yaml` or `.ai/blueprint.yaml`:

```yaml
security: hardened
```

and run `aie sync`. `.claude/settings.json` gains:

- `Read` deny rules for `.env`, `.env.*`, `*.pem`, and `*.key`, so Claude's
  file tools cannot read those files;
- `sandbox.enabled: true`, which turns on Claude Code's OS sandbox for shell
  commands. Inside it, the same rules also stop `cat .env`, and the sandbox
  protects the agent's own configuration from shell writes.

Those shell protections hold only while a command actually runs in the
sandbox. Commands still run unsandboxed on native Windows, when the sandbox
cannot start (set `sandbox.failIfUnavailable: true` to make Claude Code stop
instead), and when someone approves retrying a failed command outside it (set
`sandbox.allowUnsandboxedCommands: false` to turn those retries off). The
[threat model](threat-model.md) has the details.

Starting a new project instead? `aie init --secure` writes the preset for you.

### If you also target Codex or Cursor

Neither can enforce permission rules or sandbox settings, and each sync warns
with `permissions-unsupported` and `sandbox-unsupported`. With `--strict`,
those warnings fail. Once you have decided to live with the gap, accept it for
that target:

```yaml
# .ai/manifest.yaml
targets:
  codex:
    enabled: true
    accept: [permissions-unsupported, sandbox-unsupported]
```

```yaml
# .ai/blueprint.yaml
ai:
  runtimes: [claude, codex]
  accept:
    codex: [permissions-unsupported, sandbox-unsupported]
```

An accepted gap still prints on every run, as info. If a target stops
reporting a code you accepted, the sync warns with `accept-unused`.

### Network access

With the sandbox on, a shell command reaches no host until someone approves it.
Pre-allow the hosts your project really needs:

```yaml
sandbox:
  network:
    allowedDomains: [registry.npmjs.org]
```

Each host widens what a sandboxed command can reach. A developer whose own
user settings set `sandbox.network.strictAllowlist` has to allow these hosts
there instead: Claude Code ignores a repository's `allowedDomains` in that
case.

### What happens to your existing `settings.json`

- Entries you wrote by hand are kept, and the compiler never claims an entry
  that was already there.
- A value you set that differs from the preset is kept too. If your file
  already said `sandbox.enabled: false` before you added the preset, it stays
  false and every sync warns with `settings-value-conflict` until you remove
  that line.
- A value the compiler wrote and someone later changed by hand is different:
  the sync stops with `settings-entry-modified` and writes nothing, until you
  restore the value or remove it from `.ai/`.
- Setting `sandbox.enabled: false` in `.ai/` next to the preset is an error.
- Allowing a rule the preset denies, such as `Read(.env)`, syncs with a
  `permission-conflict` warning and leaves the rule denied.

## Check the result

```sh
npx aie audit
```

reports gaps in the configuration, each with a fix: an empty deny list
(`deny-empty`), a disabled sandbox (`sandbox-disabled`), secret files no rule
covers (`secret-readable`), auto-approved MCP servers (`mcp-auto-approve`),
and more. It exits 0 when nothing is at error severity; `--strict` also fails
on warnings. It reads files by name only, never a secret's contents.

## If you use the GitHub Action

`uses: akin-oz/ai-engineering@v0` follows the latest release, so your workflow
already runs the new version. Besides the drift check, it now runs
`aie audit` and annotates findings as warnings without failing the job. To make
findings fail it:

```yaml
- uses: akin-oz/ai-engineering@v0
  with:
    audit: fail
```

`audit: off` skips the audit.

## If you use a blueprint (`spec-driven`)

Your next `aie sync` brings in two things from the pack:

- **A harder commit guard.** The `spec-trailer` hook now reads commands the
  way a shell does, so `git -C dir commit`, `--amend` inside a message, or
  `Spec:` written in prose no longer get past it.
- **Deny rules protecting the guard**, from the pack's `protect-guardrails`
  group: Claude's edit tools can no longer edit `.claude/settings.json`,
  `.claude/settings.local.json`, `.claude/hooks/**`, or `.ai/generated/**`.

The hook can still be talked around, so put its check in CI as well. The
snippet is in `.ai/generated/rules/spec-trailer.md`. Until a workflow runs it,
`aie audit` reports `hook-no-ci-backstop`.

Either contribution can be turned off on its own:

```yaml
workflow:
  development: spec-driven
  disable: [permission.protect-guardrails, hook.spec-trailer]
```

## What each release changed

| Release | Change you might notice |
| --- | --- |
| 0.3.0 | Hooks in blueprints, `turn-end` and `pre-tool`/`post-tool` events, `workflow.disable`, and the `spec-driven` commit guard |
| 0.3.1 | The commit guard made hard to walk around; use this rather than 0.3.0 |
| 0.4.0 | `permissions` and `sandbox` blocks, `aie audit`, the Action's `audit` input; `ai` removed; the `spec-driven` pack adds `protect-guardrails` |
| 0.5.0 | `accept` for capability gaps a target cannot enforce |
| 0.5.1 | Documentation only |
| 0.6.0 | `security: hardened` and `aie init --secure` |
| 0.6.1 | Documentation only |

What each layer stops, and what it does not, is in the
[threat model](threat-model.md).
