---
description: Every commit records which spec it implements
---

Every commit message ends with a trailer naming the spec it implements:

```
Spec: 004
```

A change with no behavior change says so explicitly rather than omitting the
trailer:

```
Spec: none — refactor, no behavior change
```

The trailer is what makes the workflow checkable after the fact. "Write the
spec first" is unverifiable in a code review three weeks later; a trailer is
greppable, and it tells a reviewer which document to read the diff against.

This pack ships a hook that refuses a commit without one, so the rule is
enforced at the moment it matters rather than remembered. The hook fails open:
if it cannot read the commit command it allows the commit, because a hook bug
must never be the reason someone cannot commit.

To check the same rule in CI, over the commits a pull request adds:

```sh
git log --format='%H %s%n%b' origin/main..HEAD |
  grep -q '^Spec:' || {
    echo 'No commit in this branch declares a spec'
    exit 1
  }
```

Keep the trailer accurate when a change outgrows its spec. A commit claiming
`Spec: 004` while implementing something 004 never described is worse than no
trailer at all, because it defeats the check without anyone noticing.
