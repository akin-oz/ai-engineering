This repository is a compiler. Its output lands in other people's repositories,
so correctness and restraint matter more than features.

**Never destroy work the compiler did not create.** A file may only be deleted
or overwritten when an ownership record lists it, when it still matches the
source it was copied from, or when it carries the generated banner. There is no
fourth exception, and no feature is worth adding one.

**The core stays small.** `src/compiler/` coordinates loading, planning, and
writing. Runtime-specific knowledge — paths, Markdown structure, file naming —
belongs in an adapter. Never add a conditional on an adapter id to the compiler
core; if the core needs to know something about a runtime, the adapter contract
is missing a declaration.

**Adapters are pure.** `render(manifest)` returns file contents and never
touches the filesystem. Adapters do not import each other, and never read
another runtime's output as input.

**Dependencies are a liability.** A new runtime dependency needs a written
justification in the pull request. The answer for almost everything is the Node
standard library.

**Paths are validated, never assumed.** Every generated path is relative to the
project root, stays inside it, and never writes into `.ai/`.
