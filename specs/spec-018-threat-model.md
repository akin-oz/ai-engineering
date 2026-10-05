# Spec 018: Threat model

- Status: **Shipped in 0.4.0**
- Priority: P2
- Target release: 0.4.0
- Depends on: Specs 015, 016, 017
- Finding: the compiler now emits enforcement (permissions, sandbox, a guard
  hook) and an audit, but nothing states what each layer stops, what it does
  not, and where the gaps are. Without that, "the repository is governed"
  reads as a stronger claim than any one layer makes.

## Deliverable

`docs/threat-model.md`, describing shipped behavior only (the docs rule). One
section per layer — rules, permissions, hooks, sandbox, CI — each with:

- **Stops:** what the layer enforces, and who enforces it (the model, Claude
  Code, the operating system, CI);
- **Does not stop:** what passes through it;
- **Known limits:** including, at minimum, that hooks fail open, that string
  matching is bypassable, and that hooks and MCP servers run outside Claude
  Code's sandbox.

Statements about Claude Code's behavior cite its documentation. Statements
about this compiler's behavior cite the test that demonstrates them.

A table of concrete attacks and the layer that stops each (or nothing) closes
the document, so it can be checked row by row.

## Keeping it honest

`test/docs.test.mjs` checks the document mechanically:

- every `test/….mjs` file it cites exists;
- every backticked kebab-case name it uses (a diagnostic or finding code, a
  pack contribution) appears in `src/` or `packs/`, so a renamed code cannot
  leave the threat model describing something that no longer exists.

## Done when

- The document exists and the docs test passes on Node 20, 22, and 24.
- The README links it.
