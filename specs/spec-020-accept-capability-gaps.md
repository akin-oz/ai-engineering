# Spec 020: Accept a target's capability gaps

- Status: **Implemented — ships in 0.5.0 (unreleased)**
- Priority: P2
- Target release: 0.5.0
- Depends on: Spec 005 (diagnostics, `--strict`), Spec 016 (`permissions-unsupported`)
- Finding: a repository that targets Codex cannot declare a single permission
  rule and keep `--strict` in CI. Codex cannot enforce the rule, says so as a
  warning on every run, and `--strict` fails. This repository hit it while
  dogfooding: its choices were to drop `--strict` (silencing every other
  warning too), drop Codex (breaking the `AGENTS.md` it verifies), or declare
  no permissions at all.

## Problem

`permissions-unsupported` is a warning on purpose: a deny rule that holds in
one runtime and not another is a gap, and the default must make it visible.
But once a maintainer has seen the gap and decided to live with it, the warning
carries no new information, and `--strict` turns a known, accepted fact into a
red build. The only way out today is to weaken the whole check.

## Design

A target names the capability gaps it accepts:

```yaml
# .ai/manifest.yaml
targets:
  codex:
    enabled: true
    accept: [permissions-unsupported]
```

```yaml
# .ai/blueprint.yaml
ai:
  runtimes: [claude, codex]
  accept:
    codex: [permissions-unsupported]
```

- **Only capability gaps can be accepted:** `capability-unsupported`,
  `permissions-unsupported`, `sandbox-unsupported`. Naming any other code is an
  error listing the ones that can be. A hand-edited settings entry, a
  collision, an unknown sandbox key are not facts about a runtime, and
  accepting them would hide a mistake.
- **Acceptance is per target.** Accepting `permissions-unsupported` for Codex
  says nothing about Cursor; a Cursor target still warns. A blueprint cannot
  accept for a runtime it does not list.
- **Accepted is not silent.** The diagnostic keeps its code, drops to `info`,
  gains `accepted: true` in `--json`, and its message says where it was
  accepted. It still prints on every run.
- **A stale acceptance warns.** Accepting a code the target never emits — the
  workspace stopped declaring permissions, or the runtime learned to enforce
  them — reports `accept-unused` (warning). An acceptance nobody re-reads
  should not outlive its reason.
- The core applies acceptance to whatever an enabled adapter returns, keyed by
  the adapter's id from the manifest. No adapter-specific logic is added.

## Tests

End to end in `test/accept.test.mjs`:

- `permissions-unsupported` accepted for Codex: sync and `validate --strict`
  exit 0, the diagnostic is `info` with `accepted: true`;
- the same workspace without `accept`: `--strict` exits 1 (unchanged behavior);
- acceptance is per target: accepting for Codex leaves Cursor's warning;
- `accept-unused` fires for a code the target does not emit, and stays quiet
  when every accepted code fires;
- accepting a code that is not a capability gap, or an unknown code, is an
  error;
- the blueprint form compiles to the same result.

## Dogfooding

This repository declares deny rules for secret files in its own manifest and
accepts `permissions-unsupported` for Codex, so CI keeps `--strict`.

## Done when

- Tests pass on Node 20, 22, and 24; CI's `validate --strict` passes with the
  repository's permissions declared.
- `docs/adapter-api.md` and the README describe `accept`; `CHANGELOG.md` has
  an entry.
