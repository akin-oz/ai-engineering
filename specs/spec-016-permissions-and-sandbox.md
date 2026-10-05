# Spec 016: Compile permissions and sandbox settings

- Status: **Implemented — ships in 0.4.0 (unreleased)**
- Priority: P1
- Target release: 0.4.0
- Depends on: Spec 001 (ownership), Spec 009 (settings merge), Spec 010 (packs)
- Finding: the compiler can install a guard (a hook) but not the fence around
  it. Every repository that wants `Read(./.env)` denied, or the Bash sandbox on,
  hand-wires `.claude/settings.json` — exactly the unowned, unreviewed drift the
  compiler exists to remove. And because hand-wired entries live outside any
  source, nothing checks that each runtime the repository targets actually
  enforces them.

## Problem

`docs/architecture.md` lists `permissions` as a key the user owns and says
widening the settings surface is "a future decision … one key at a time". This
spec makes that decision for two keys, `permissions` and `sandbox`, because
they are the two that turn instructions into enforcement:

- An instruction in `CLAUDE.md` asks the model not to read `.env`. A
  `permissions.deny` entry makes the runtime refuse.
- A hook is a script the runtime runs on the model's behalf. The sandbox is the
  operating system refusing a shell command's write or connection.

## Inputs

Both workspace styles accept the same two top-level blocks.

```yaml
permissions:
  allow:
    - Bash(npm test)
  deny:
    - Read(./.env)
    - Read(./.env.*)

sandbox:
  enabled: true
  allowUnsandboxedCommands: false
  filesystem:
    denyRead: ["~/.aws"]
  network:
    allowedDomains: [registry.npmjs.org]
```

- `permissions` accepts `allow` and `deny`, each a list of non-empty strings.
  Any other key is an error. (`ask` and `defaultMode` are left to the user until
  a repository asks for them; one key at a time.)
- Rule strings are passed through as written. They are the runtime's own
  vocabulary, like hook tool names, so they are only meaningful where a runtime
  can enforce them — see Codex and Cursor below.
- `sandbox` must be a mapping. The core checks only that it is JSON-compatible;
  the Claude adapter knows the key names (from
  <https://code.claude.com/docs/en/sandboxing> and the settings reference) and
  warns on any it does not recognize, with code `sandbox-unknown-key`, rather
  than rejecting it — the runtime adds keys faster than this compiler releases.

### Deny wins

A rule that appears in both `allow` and `deny`, from any combination of pack
and workspace, is dropped from `allow` with a `permission-conflict` warning.
The runtime evaluates deny before allow anyway; removing the allow keeps the
generated file from looking like it grants something it does not.

Lists are deduplicated, preserving the order of first declaration (pack first,
then workspace). Output is deterministic.

### Packs contribute named permission groups

A pack may contribute permission groups:

```yaml
contributes:
  permissions:
    - id: protect-guardrails
      deny:
        - Edit(./.claude/settings.json)
        - Edit(./.claude/hooks/**)
        - Edit(./.ai/generated/**)
```

`workflow.disable: [permission.protect-guardrails]` drops one group, with the
same unknown-name error as every other disable. Packs do not contribute
`sandbox` settings: turning the sandbox on changes what every shell command can
reach, and that is a repository's decision, not a workflow's.

The `spec-driven` pack ships `protect-guardrails`. Its hook is only a guard if
the agent it guards cannot edit it, or the settings entry that runs it. `Edit`
rules cover every built-in file-editing tool; shell writes to these paths are
covered by the sandbox's own protected paths when the sandbox is on, and by
nothing when it is off — which is what `aie audit` (Spec 017) will report.

## Claude adapter: merging under the ownership model

`.claude/settings.json` stays the user's file. The compiler owns individual
entries, recorded verbatim in the ownership record, exactly as for hooks:

| Shape | The compiler owns | A sync |
| --- | --- | --- |
| `permissions.allow[]`, `permissions.deny[]`, every array under `sandbox` | the entries it added | appends planned entries the file does not already have; removes owned entries no longer planned |
| scalars under `sandbox` (`enabled`, `failIfUnavailable`, …) | values it set | sets planned values on absent keys; removes owned keys no longer planned |

Rules that keep the "never destroy work the compiler did not create" promise:

1. **An entry the file already had is never claimed.** If the user wrote
   `Read(./.env)` before the workspace declared it, the compiler leaves it,
   does not record it as owned, and therefore never removes it later.
2. **A scalar the user set is never overwritten.** If `sandbox.enabled` is
   `false` in the file and the workspace plans `true`, the compiler keeps
   `false` and reports `settings-value-conflict` (warning). The repository's
   compiled policy is weaker than its source says, and that must be visible.
3. **A hand edit to an owned entry stops the sync.** An owned scalar whose value
   changed, or an owned list entry that was removed while still planned,
   reports `settings-entry-modified` (error) — the same code hooks use — and
   nothing is written. Restore it, or remove it from `.ai/`.
4. Every other key, and every entry the compiler did not write, is untouched.

The ownership record keeps hook entries under their Claude event names, as in
0.3.x, and adds `permissions` and `sandbox` keys only when something is owned
there. Claude event names are capitalized, so the keys cannot collide, and a
workspace with only hooks keeps a byte-identical record across the upgrade —
`aie check` does not report drift merely because the tool was updated.

`settings.json` is still not created unless the workspace declares a hook, a
permission, or a sandbox setting.

## Codex and Cursor: say what is not enforced

Neither runtime has a repository-level equivalent of these rule lists. Each
adapter emits one diagnostic per block it cannot express:

| Code | When |
| --- | --- |
| `permissions-unsupported` | the workspace declares any `permissions` entry |
| `sandbox-unsupported` | the workspace declares any `sandbox` setting |

Severity is **warning**, not the `info` used for an unsupported command. A
missing command is a missing convenience; a deny rule that one runtime silently
ignores is a policy that holds in one tool and not the other. `--strict` fails
on it, which is the point of `--strict`.

(Codex does have a coarse `sandbox_mode` in `.codex/config.toml`. Mapping the
Claude-shaped settings onto it would be a translation the user did not write;
that is a separate decision with its own spec if anyone asks for it.)

## Adapter contract

`capabilities` gains `permissions` and `sandbox`, each `"settings-merge"` or
`"unsupported"`. Adapters receive `manifest.permissions` (`{ allow, deny }`,
already deduplicated with deny winning) and `manifest.sandbox` (an object, empty
when undeclared). No conditional on an adapter id is added to the core.

## Tests

End to end, through the CLI, in `test/permissions.test.mjs`:

- permissions and sandbox compile into `.claude/settings.json`;
- user entries and keys survive, including user hook entries;
- an entry the user already had is not claimed (removing it from the manifest
  leaves it in place);
- removing a declared entry removes exactly that entry;
- a user scalar is not overwritten — `settings-value-conflict` fires; and stays
  quiet when the user value matches or is absent;
- a hand-removed owned entry and a hand-edited owned scalar each fail with
  `settings-entry-modified`; quiet when untouched;
- deny wins — `permission-conflict` fires; quiet without overlap;
- Codex and Cursor emit `permissions-unsupported` / `sandbox-unsupported`;
  quiet when nothing is declared; `--strict` fails on them;
- an unknown sandbox key warns with `sandbox-unknown-key`; quiet for known keys;
- invalid shapes (`permissions.ask`, a non-string rule) are errors;
- the pack's `protect-guardrails` group compiles, and `permission.protect-guardrails`
  disables it;
- syncing twice produces a byte-identical tree;
- a hooks-only ownership record written by 0.3.x is read unchanged.

## Done when

- The tests above pass on Node 20, 22, and 24.
- `docs/architecture.md`'s ownership table and `docs/adapter-api.md` describe
  the new keys; the README runtime table gains the columns.
- `CHANGELOG.md` has a 0.4.0 section.
