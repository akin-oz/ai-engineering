---
description: Public API conventions for source files
scope: src/**/*.ts
---

This package is consumed by other people's builds, so its public surface changes
slowly and deliberately.

Export types alongside every public function, and never widen a return type in a
patch release. Prefer named exports; a default export makes the package harder
to re-export and tree-shake.

Internal helpers stay internal — if something is not in `src/index.ts`, callers
cannot depend on it, and it can change freely. When you are tempted to export a
helper "just for tests", test it through the public surface instead.
