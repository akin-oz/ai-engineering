Documentation in this repository is layered, and the layer determines what a
statement is allowed to claim.

- `docs/` describes **shipped behavior only**. Every statement must be true of
  the released package and demonstrable at HEAD.
- `specs/` holds scoped work that is committed but not finished.
- `rfcs/` holds design that may never be built.

Never describe planned behavior in `docs/` or the README. Version 0.1 shipped
hundreds of lines of architecture documentation for features that did not
exist, which made every real claim harder to trust.

**Claims must be checkable.** If the README says this repository dogfoods the
compiler, CI verifies it. If it lists a supported runtime, an example compiles
for that runtime.

**Every user-visible change gets a changelog entry** in the same pull request,
and a released version always has all four of: a git tag, an npm publish, a
changelog section, and a release note.
