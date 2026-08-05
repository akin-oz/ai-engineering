Tests here exist to catch the failures that shipped in 0.1: output written where
no runtime reads it, a sync that deleted user files, and a golden path that
compiled to nothing while reporting success. Unit tests on hand-built manifests
missed all three.

**Behavior changes need an end-to-end test.** `test/e2e.test.mjs` drives the
real CLI binary against a temporary repository and asserts on the resulting
files and exit codes. A change to what users get is not covered until a test
there fails without it.

**Assert on files and exit codes, not log lines.** Output formatting may change;
generated content and exit codes are the contract.

**Every diagnostic code needs both cases:** one test proving it fires, one
proving it stays quiet.

**Determinism is a test, not an aspiration.** Compiling twice must produce a
byte-identical tree.

`npm test` must pass on Node 20, 22, and 24, and must stay fast enough that no
one is tempted to skip it.
