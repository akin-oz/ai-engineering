# Spec 021: A `security: hardened` preset

- Status: **In progress**
- Priority: P1
- Target release: 0.6.0
- Depends on: Spec 016 (permissions, sandbox), Spec 017 (`aie audit`), Spec 020 (`accept`)
- Finding: every piece of a defended configuration now exists — deny rules,
  the sandbox, accepted gaps, an audit — but a project has to know about and
  assemble each one. This repository took six pull requests to get from
  "audit reports two findings" to "audit reports none". A project adopting the
  compiler should get there with one line, and keep getting the current best
  version of it as the compiler improves.

## Design

A workspace names a security preset:

```yaml
# .ai/manifest.yaml or .ai/blueprint.yaml
security: hardened
```

`hardened` expands at load time, before adapters run, to:

```yaml
permissions:
  deny: [Read(.env), Read(.env.*), Read(*.pem), Read(*.key)]
sandbox:
  enabled: true
```

The deny list is exactly the set of files `aie audit` reports as
`secret-readable`, so a hardened workspace with no other secrets audits clean.

### Composition

- **Explicit blocks still apply.** A workspace's own `permissions` and
  `sandbox` are combined with the preset: permission rules are unioned (pack
  groups first, then the preset, then the workspace), and deny still wins
  (`permission-conflict`). Sandbox keys the workspace sets are added to the
  preset's.
- **Contradicting the preset is an error.** A workspace that says
  `security: hardened` and also sets `sandbox.enabled: false` has two answers
  to one question. The compiler refuses rather than picking one silently.
- **Only known presets.** Any other value is an error that lists the presets.
- **The preset is not frozen into the source.** A later release that improves
  `hardened` (more secret patterns, say) reaches every workspace on its next
  sync, and `aie check` reports the drift until it does. The changelog names
  every change to a preset.

### Runtimes that cannot enforce it

Codex and Cursor still warn (`permissions-unsupported`, `sandbox-unsupported`)
for a hardened workspace, exactly as for explicit blocks. The preset does not
accept those gaps on a project's behalf: accepting is a decision (Spec 020).

### `aie init --secure`

Writes `security: hardened` into the new manifest or blueprint, and accepts
both gaps for the Codex target it scaffolds, with a comment saying why, so a
fresh secure workspace passes `validate --strict` on its first sync, and a
manifest workspace audits clean. The acceptance is in the file, visible and removable.

### `aie audit` hints

The fixes for `deny-empty`, `sandbox-disabled`, and `secret-readable` mention
`security: hardened` as the one-line fix.

## Tests

End to end, in `test/security.test.mjs`:

- `security: hardened` compiles to exactly the deny list and `sandbox.enabled`;
- explicit `permissions` and `sandbox` combine with the preset, and deny wins;
- `sandbox.enabled: false` with the preset is an error; an unknown preset is an
  error;
- the blueprint form compiles to the same settings, after the pack's groups;
- Codex still warns without `accept`;
- `aie init --secure` then `aie sync`: `validate --strict` exits 0, and
  `aie audit` reports no findings for a manifest. A blueprint reports exactly
  one, `hook-no-ci-backstop`: it ships the `spec-driven` commit hook, whose CI
  check belongs in the project's own pipeline;
- syncing twice is byte-identical.

## Done when

- Tests pass on Node 20, 22, and 24.
- README, `docs/adapter-api.md`, and the threat model describe the preset.
- `CHANGELOG.md` has an entry.
