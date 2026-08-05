# RFC 0001: Workflow compiler architecture

- Status: **Accepted, not implemented**
- Implemented by: [spec 010](../specs/spec-010-workflow-pack-mvp.md) (one pack
  end to end; the engine phases below stay unbuilt until that pack has users)

> This is design, not documentation. Nothing here describes shipped behavior.
> For what the tool does today, read [docs/](../docs).

This project should evolve from a runtime configuration compiler into a
workflow compiler. The important distinction is that a runtime adapter answers
“where does this instruction go?”, while the workflow compiler answers “what
engineering system should this repository have?”.

The workflow compiler should be an upstream phase of the existing pipeline:

```text
blueprint.yaml + workflow packs + local overrides
                    |
             load and validate
                    |
          normalized workflow graph
                    |
             materialize .ai/
                    |
          existing runtime adapters
                    |
       .claude/ .codex/ and future targets
```

This keeps the current adapter contract intact. Claude and Codex do not need
to understand what “spec-driven” or “release review” means; they render the
already-composed engineering intent.

## 1. Blueprint schema

The blueprint is the portable description of a repository's engineering
workflow. It should be declarative, versioned, and independent of any AI
runtime.

```yaml
schema: 2

project:
  type: library                 # library | saas | cli | research | monorepo

stack:
  language: typescript          # typescript | python | go | ...
  runtime: node

workflow:
  development: spec-driven     # spec-driven | tdd | rapid-prototyping
  reviews:
    architecture: true
    release: true
    documentation: true

ai:
  runtimes: [claude, codex]

preferences:
  testing:
    framework: node-test
  documentation:
    style: architecture-first
  release:
    conventional_commits: true

overrides:
  disable: []
  replace: {}
```

The minimum stable vocabulary is:

- `project`: project shape and optional repository metadata.
- `stack`: language, runtime, package manager, framework, and persistence
  choices used for capability selection.
- `workflow`: named development workflow and enabled review capabilities.
- `ai.runtimes`: target adapter IDs. This replaces the user's need to hand
  assemble runtime directories, but remains an adapter concern at compile time.
- `preferences`: explicit knobs for capabilities, such as test framework,
  documentation style, commit convention, or branch policy.
- `overrides`: narrow, named changes to selected generated capabilities.

Unknown fields should be rejected in strict mode and reported as warnings in a
future compatibility mode. Every default must be resolved during normalization
so adapters and generated files never depend on implicit runtime behavior.

### Compatibility with the current manifest

Do not replace `manifest.yaml` in one release. Support two input modes:

1. Schema 1: load the existing hand-authored `targets`, `agents`, and `rules`
   exactly as today.
2. Schema 2: load the blueprint, compose capabilities, and produce the same
   normalized content model consumed by adapters.

The loader can expose a common normalized manifest shape:

```js
{
  version: 2,
  root,
  targets: { claude: { enabled: true }, codex: { enabled: true } },
  agents: [{ id, source, content, metadata }],
  rules: [{ id, source, content, metadata }],
  templates: [{ id, source, content, metadata }],
  reviews: [{ id, prompt, checks, metadata }],
  documentation: [{ path, content, metadata }],
  conventions: [{ id, content, metadata }],
  files,
  resolve
}
```

Existing adapters should temporarily accept both string names (schema 1) and
normalized entries. A compatibility projection can keep their current file
resolution API unchanged while the richer graph is introduced behind it.

## 2. Workflow composition model

Workflows are compositions of reusable capability packs, not monolithic
templates. A pack is a versioned, runtime-neutral bundle that can contribute
any of the following:

```text
capability pack
  metadata and applicability rules
  agents
  rules
  templates
  review definitions
  documentation skeleton
  repository conventions
  dependencies on other capabilities
```

Examples of packs are `development/spec-driven`,
`testing/node-test`, `review/architecture`, `release/conventional-commits`,
and `documentation/architecture-first`. `project.type` and `stack` select
packs; `workflow` explicitly enables workflow packs; preferences configure
them.

Composition should be a deterministic graph operation:

1. Resolve the requested workflow and stack capabilities.
2. Add transitive dependencies.
3. Topologically order capabilities by declared dependencies.
4. Merge contributions by stable ID.
5. Apply defaults, then user overrides.
6. Detect conflicts instead of silently choosing one.
7. Freeze the resulting graph and record its provenance.

Each contribution needs a stable ID such as
`review.architecture`, `rule.spec-driven.change-boundary`, or
`template.release-notes`. Stable IDs make disable/replace operations and
diagnostics understandable. A contribution should also record its originating
pack and version so generated diffs can explain why a file changed.

Precedence should be explicit:

```text
built-in defaults < selected packs < project-type packs < local overrides
```

Two packs that write the same semantic ID must either merge through a declared
strategy or fail with a conflict diagnostic. File-path collisions are always
errors unless a pack explicitly declares an ownership/merge strategy.

## 3. Template generation

Templates are source artifacts, not prompt strings embedded in runtime
adapters. A template definition should contain:

```yaml
id: template.spec
kind: workflow-template
path: templates/spec.md
variables: [project, stack, conventions]
when: development == spec-driven
```

The generator renders templates against the normalized blueprint and selected
capabilities using a small, deterministic template engine. It should expose
structured context and a limited helper set; arbitrary code execution does not
belong in a workflow pack.

Generated files should be clearly separated from user-authored files:

```text
.ai/
├── blueprint.yaml             # portable user input
├── overrides/                 # optional user-owned patches
├── generated/                 # compiler-owned, replaceable output
│   ├── agents/
│   ├── rules/
│   ├── templates/
│   ├── reviews/
│   ├── docs/
│   └── conventions/
└── manifest.yaml              # optional schema-1 compatibility input
```

The materializer should replace only `.ai/generated/`, never the whole `.ai/`
directory. This lets users retain local additions during migration and makes
`ai sync` safe to run repeatedly. The runtime adapters can initially read from
both the legacy directories and generated directories through the normalized
manifest.

## 4. Agent generation

Agents are generated from role capabilities, not directly from project names.
For example, `development/spec-driven` may contribute a `spec-author` and
`implementation` role, while `review/architecture` contributes an
`architecture-reviewer` role.

An agent definition should include:

```yaml
id: reviewer.architecture
role: architecture-reviewer
purpose: Evaluate structural changes against the repository architecture.
inputs: [changed-files, architecture-docs, active-spec]
rules: [architecture.boundaries, documentation.decision-records]
reviews: [review.architecture]
```

The compiler resolves references, renders the agent prompt/body, and emits
one canonical source artifact. Runtime adapters decide whether that becomes a
Claude agent file, a Codex section, or a future runtime construct. A generated
agent should never refer to a runtime-specific path in its source definition.

## 5. Rule generation

Rules are policy contributions with scope and provenance. Packs should be able
to contribute rules such as test-before-merge, spec-change-required,
conventional-commits, or documentation-update-required.

Rules should support at least:

- stable ID and human-readable title;
- content and severity (`info`, `warning`, `error`);
- selectors for project areas or file patterns;
- references to agents, reviews, and templates;
- an explicit conflict/override policy.

The first implementation can render all rules as Markdown, preserving the
current adapter behavior. Selectors can remain metadata until a runtime or
future validation command needs enforcement.

## 6. Review generation

Reviews are structured workflow nodes, rather than standalone prompts. A
review definition should describe its trigger, inputs, checklist, and output:

```yaml
id: review.release
trigger: release
agent: reviewer.release
inputs: [change-summary, changelog, version, test-results]
checks:
  - id: tests
    question: Are relevant tests present and passing?
  - id: compatibility
    question: Are breaking changes called out?
output:
  template: template.release-review
  decision: approve-or-request-changes
```

The compiler generates review prompts, checklists, and supporting templates
from this model. It should also emit a machine-readable review index so future
CLI commands can run or inspect reviews without parsing Markdown. The first
release need only materialize prompt artifacts; execution orchestration can be
added later.

## 7. Runtime generation

Runtime generation remains an adapter concern. The workflow compiler produces a
runtime-neutral graph and a materialized `.ai/generated` source tree. Existing
adapters receive a normalized projection and continue to own:

- output paths;
- runtime-specific filenames and Markdown structure;
- copying versus aggregation;
- runtime manifests and metadata;
- complete managed-output replacement.

`ai init` should eventually launch the wizard and write a blueprint. `ai sync`
should then run:

```text
load blueprint
  -> resolve capability registry
  -> compose and validate graph
  -> materialize .ai/generated
  -> render enabled adapters
```

`ai validate` should run every phase except writes. `ai diff` can later explain
which blueprint field or capability caused a generated change.

Runtimes must not influence workflow selection. Selecting Claude and Codex
changes output targets only; it must not change the engineering rules or review
criteria.

## 8. Future extensibility

The minimum extension points should be narrow and injectable, matching the
current adapter registry:

```js
const capability = {
  id: "review.architecture",
  version: "1.0.0",
  requires: ["development.shared-context"],
  matches: (context) => context.workflow.reviews.architecture === true,
  contribute: (context) => ({ agents, rules, reviews, templates }),
};
```

Initially, built-in capabilities can be loaded from a package directory. Later
versions can add package entry points or an injected capability registry without
making plugin loading part of the compiler core. Capability packs should be
versioned independently, tested against fixture blueprints, and forbidden from
writing outside their declared contribution set.

Likely later additions are monorepo project units, conditional capabilities,
organization presets, remote/private workflow packs, incremental compilation,
lockfiles, and additional runtime adapters. None requires changing the core
idea: blueprint in, immutable workflow graph out, adapters last.

## Incremental implementation roadmap

### Phase 0 — document and protect the current contract

- Treat schema 1 and the current adapter API as compatibility contracts.
- Add fixture-based tests for deterministic output and stale-file removal.
- Define generated ownership boundaries and diagnostics before adding new files.

### Phase 1 — blueprint loading without generation changes

- Add schema 2 validation and normalized blueprint types.
- Add `ai init --blueprint` or equivalent non-interactive input support.
- Project schema 2 into the existing target/agent/rule manifest for a minimal
  proof using one built-in workflow.

### Phase 2 — capability registry and graph composition

- Add an injectable capability registry beside the adapter registry.
- Implement IDs, dependencies, applicability, contribution merging, conflicts,
  provenance, and deep freezing.
- Add `ai explain` output for selected and omitted capabilities.

### Phase 3 — generated source workspace

- Materialize `.ai/generated/` atomically.
- Teach the manifest loader to combine generated content with explicitly
  supported legacy content and local overrides.
- Keep Claude and Codex adapters unchanged where possible.

### Phase 4 — reviews, documentation, and conventions

- Add structured review and documentation contributions.
- Generate the documentation skeleton and repository convention files.
- Emit a machine-readable workflow index alongside Markdown artifacts.

### Phase 5 — wizard and distribution

- Implement `ai init` as a wizard that writes a portable blueprint.
- Add named presets such as solo, startup, OSS, and enterprise as ordinary
  capability bundles, not special compiler branches.
- Add lockfile/version reporting and plugin entry-point discovery.

At every phase, schema 1 repositories must continue to compile. Migration can
be an explicit command that creates a schema 2 blueprint from existing files;
it should never be an implicit destructive rewrite.

## Design outcome

The resulting product has three clear responsibilities:

1. The blueprint captures the engineer's philosophy once.
2. Capability composition turns that philosophy into a reusable workflow.
3. Runtime adapters publish the workflow wherever an AI coding assistant needs
   it.

That separation makes “my default engineering workflow” portable without
turning the compiler into a collection of hardcoded Claude/Codex recipes.
