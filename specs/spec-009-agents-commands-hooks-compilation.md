# Spec 009: Agents, commands, and hooks as first-class compiled artifacts

- Status: **Shipped in 0.2.0**
- Priority: P1 (the strategic bet)
- Target release: 0.3.0
- Depends on: Spec 001 (ownership), Spec 002 (surface), Spec 003 (selection), Spec 005 (diagnostics)
- Review finding: plain rules are converging on the AGENTS.md standard, which
  erodes the compile-N-formats premise. What has *not* converged — subagents,
  slash commands, hooks, skills — is where per-runtime compilation still earns
  its keep. v0.1 "supported" hooks by blind directory copy, which wires nothing
  in any runtime.

## Problem

Rules are text; any tool can sync text. Agents, commands, and hooks are
*structured, runtime-specific configuration* — different file formats, different
locations, different capability sets per runtime, and (for hooks) wiring inside
a shared settings file the compiler must not own wholesale. Compiling these
correctly, with honest diagnostics about what each runtime can and cannot
express, is the durable differentiator.

## Design

### Runtime-neutral source model

Sources stay Markdown-first with optional YAML frontmatter, parsed by the
loader and exposed on normalized manifest entries as `metadata`:

```markdown
---
description: Reviews changes for architectural boundary violations
---
You are the architecture reviewer for this repository. ...
```

Hooks are the exception — they are configuration, not prose, so they are
declared in the manifest with a normalized event vocabulary:

```yaml
hooks:
  - id: format-on-write
    event: post-edit          # normalized: pre-edit | post-edit | pre-commit | session-start
    matcher: "*.ts"
    run: hooks/format.sh      # relative to .ai/
```

The normalized event vocabulary is deliberately small and grows only when two
runtimes can express a new event. Scripts live under `.ai/hooks/` as ordinary
source files.

### Capability declaration and honest diagnostics

Each adapter declares what it can express:

```js
export const capabilities = {
  agents:   "native",        // native | inline | unsupported
  commands: "native",
  hooks:    "settings-merge",
};
```

For every source artifact an adapter cannot express, compilation emits a
diagnostic — `info` when the limitation is inherent to the runtime and
documented (Codex repo-level commands), `error` when the user asked for
something impossible (a hook event no enabled runtime supports). **Nothing is
ever skipped silently.** This diagnostic surface — "Codex does not support
hooks; `format-on-write` applies to Claude only" — is a feature no competitor
has, and it must read like one: precise, sourced, actionable.

### Claude adapter mapping

| Source | Output | Notes |
| --- | --- | --- |
| agents | `.claude/agents/<name>.md` | frontmatter passed through verbatim |
| commands | `.claude/commands/<name>.md` | verbatim |
| hook scripts | `.claude/hooks/<file>` | owned files, copied, kept executable |
| hook wiring | `hooks` key inside `.claude/settings.json` | **JSON-path ownership**, below |

#### JSON-path ownership for `settings.json`

`settings.json` is user territory; Spec 001's file-level ownership cannot apply.
The Claude adapter instead:

1. reads existing `.claude/settings.json` (missing → `{}`; unparseable →
   error diagnostic, never overwrite);
2. computes the compiler-owned hook entries from the manifest, mapping
   normalized events to Claude hook events/matchers;
3. replaces exactly the entries recorded as owned in the previous state, adds
   new ones, removes stale owned ones — all other keys and all user-authored
   hook entries preserved byte-semantically (stable key order, 2-space indent);
4. records the owned JSON paths in the ownership record:

```json
{ "paths": [".claude/hooks/format.sh"],
  "jsonPaths": { ".claude/settings.json": ["hooks.PostToolUse[id=aie:format-on-write]"] } }
```

Owned entries carry a namespaced marker (`"id": "aie:format-on-write"` or a
comment-equivalent field) so they are identifiable in the file itself and in
diffs. A user hand-editing an owned entry produces a collision diagnostic on
next sync (same policy as Spec 001, applied at entry granularity).

### Codex adapter mapping

| Source | Behavior |
| --- | --- |
| agents | `## Agent:` sections in root `AGENTS.md` (existing) |
| commands | `info` diagnostic: not expressible at repo level |
| hooks | `info` diagnostic: not expressible |

Revisit whenever Codex grows the corresponding surface; the capability
declaration makes that a one-line change plus tests.

## Requirements

1. `settings.json` keys not owned by the compiler MUST survive any sync
   byte-for-byte-semantically. Canonical test: settings with user permissions +
   user hooks + compiler hooks, synced twice, user content identical.
2. Every unexpressible artifact MUST produce exactly one diagnostic per
   sync, with a stable code (`capability-unsupported`).
3. A hook event unsupported by *all* enabled runtimes is a validation `error`;
   supported by some, `info` for the others.
4. Frontmatter in agent/command sources MUST pass through to Claude output
   unmodified and MUST be stripped from Codex inline sections.
5. Hook scripts MUST be validated to exist and be inside `.ai/` at validate
   time; the executable bit is preserved on copy.
6. Phasing: agents + commands (both already near-working) may ship before
   hooks; hooks MUST NOT ship without the JSON-path ownership mechanism —
   an interim whole-file takeover of `settings.json` is forbidden.

## Acceptance criteria

- A workspace with 1 agent, 1 command, 1 post-edit hook compiles to: agent and
  command files, hook script, a `settings.json` containing the wired hook
  alongside pre-existing user permissions — verified in e2e (Spec 006 harness).
- Removing the hook from the manifest and syncing removes the script and the
  settings entry, leaving user settings otherwise untouched.
- Codex target with the same workspace prints exactly two `info` diagnostics
  (command, hook) and renders the agent inline.

## Out of scope

- Skills / MCP-server configuration compilation (future spec once the hooks
  mechanism has proven the settings-merge model).
- Normalized events beyond the initial four.
- Executing hooks or validating script contents.
