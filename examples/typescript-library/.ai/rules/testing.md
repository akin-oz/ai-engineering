---
description: How changes to this library are tested
---

Every bug fix starts with a failing test that reproduces the report, written
before the fix. If the bug cannot be reproduced in a test, say so in the pull
request rather than fixing it blind.

Test the public API, not the implementation. A test that imports an internal
module proves the implementation matches itself and blocks refactoring.

Type-level behavior needs type-level tests: assert that invalid usage fails to
compile, not only that valid usage runs.
