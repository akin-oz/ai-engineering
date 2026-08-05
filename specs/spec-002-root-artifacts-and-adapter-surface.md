# Spec 002: Root-level artifacts and the adapter surface contract

- Status: **Shipped in 0.2.0**
- Priority: P0
- Target release: 0.2.0
- Depends on: Spec 001
- Review finding: v0.1 output is not consumed by either target tool. Codex reads
  the repo-root `AGENTS.md`, but the adapter writes `.codex/AGENTS.md`. Claude
  Code's primary context file is a root `CLAUDE.md`, which is never generated.
  `docs/runtime-parity.md` already concedes the current surface is "too narrow
  for a usable runtime installation".

## Problem

The compiler's only job is to produce files the runtimes actually load. Today it
produces files in locations the runtimes ignore. This spec implements the
minimum viable subset of the runtime-parity plan: root instruction files, plus
the `surface` declaration needed to manage them safely.

## Design

### Adapter surface declaration

Adapters gain the optional `surface` export from `docs/runtime-parity.md`,
implemented now for both built-ins:

```js
export const surface = {
  version: 1,
  artifacts: [
    { id: "root-instructions", kind: "file", path: "CLAUDE.md" },
    { id: "agents", kind: "directory", path: ".claude/agents" },
    { id: "commands", kind: "directory", path: ".claude/commands" },
  ],
};
```

The compiler core, before rendering:

1. validates each surface (relative paths, inside project root, not under
   `.ai/`);
2. builds a global ownership table across enabled adapters;
3. rejects any path claimed by two adapters with a diagnostic naming both.

Legacy adapters without `surface` remain valid and are treated as owning
`manifest.resolve.output(id)` only; they cannot write root files.

### Claude adapter surface (0.2.0)

| Artifact | Path | Content |
| --- | --- | --- |
| root-instructions | `CLAUDE.md` | Generated: banner + rendered rule sections |
| agents | `.claude/agents/<name>.md` | Copy of each manifest-listed agent |
| commands | `.claude/commands/<name>.md` | Copy of each manifest-listed command (Spec 003) |

Decision: rules render **inline into `CLAUDE.md`** and the `.claude/rules/`
output directory is dropped. Rationale: inlining is deterministic and
independent of Claude Code version behavior, and emitting rules in two loaded
locations would double-inject the same context. `CLAUDE.md` is rendered from
`.ai/templates/claude.md` when present, otherwise from a built-in default
template shipped in the package. Both use the same `{{RULES}}` placeholder
semantics as the Codex template.

### Codex adapter surface (0.2.0)

| Artifact | Path | Content |
| --- | --- | --- |
| root-instructions | `AGENTS.md` | Banner + rendered rule and agent sections |

`.codex/` is no longer written at all: v0.1 put nothing meaningful in it, and an
empty reserved directory is clutter. The source template is renamed
`.ai/templates/agents.md`; `codex-agents.md` remains accepted with a deprecation
warning for one minor release. A built-in default template is used when neither
file exists.

Migration: if a legacy `.codex/AGENTS.md` exists and begins with the generated
banner, sync removes it and prunes `.codex/` if empty. A legacy file without the
banner is left alone and reported.

### Generated banner

Every generated **root-level** file MUST begin with the HTML-comment banner
(generator name, target id, DO NOT EDIT). Files inside managed dot-directories
keep their source content verbatim (agent frontmatter must survive untouched).

## Requirements

1. After `ai sync`, launching Claude Code in the repo MUST load the generated
   instructions (root `CLAUDE.md` exists with content), and launching Codex
   MUST load the generated `AGENTS.md` (root location).
2. Root files MUST be managed through Spec 001 ownership; a user's pre-existing
   `CLAUDE.md`/`AGENTS.md` is a collision, never silently replaced.
3. Section rendering MUST omit empty sections cleanly: a manifest with zero
   agents produces no `## Agent:` heading and no dangling separator.
4. Rendering MUST be shared: one section renderer used by both adapters so
   ordering, separators, and trimming cannot drift between runtimes.
5. Two enabled adapters claiming the same root path MUST fail validation before
   any write, naming both adapters.
6. `render` MUST return `{ artifacts: [{ path, action }] }` where action is
   `created | updated | unchanged | removed` (consumed by Spec 005 reporting).

## Acceptance criteria

- Fresh `ai init && ai sync` yields root `CLAUDE.md` and root `AGENTS.md`, each
  containing the seeded rule text (Spec 004), plus ownership records for both.
- A repo upgraded from 0.1.x with a banner-bearing `.codex/AGENTS.md` ends up
  with root `AGENTS.md`, no `.codex/`, and a `removed` action in the summary.
- Second sync with no source changes reports every artifact `unchanged` and the
  working tree is byte-identical (`git diff --exit-code`).

## Out of scope

- Hooks and settings-file management (Spec 009).
- `.claude/rules/` as an output target (revisit only if inlining proves
  insufficient in practice; record the decision change in an RFC).

## Migration

0.2.0 release notes MUST list the new root-managed files and the `.codex/`
removal explicitly. `ai validate` on a schema-1 workspace MUST keep passing.
