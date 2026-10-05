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

The trailer must be a git trailer: the last paragraph of the message, in
`Key: value` form. A `Spec:` in the subject line or in prose does not count,
because neither `git log --format='%(trailers)'` nor a reviewer's tooling will
find it there.

This pack ships a hook that refuses a commit without one, so the rule is
enforced at the moment it matters rather than remembered. It reads the commit
message the way git will (from `-m`, `-F`, or a quoted here-document) and asks
`git interpret-trailers` whether the trailer is there. A message it cannot read
without running something, such as one held in a variable, is refused with
instructions; write it literally instead. The hook fails open when it breaks:
if node or git is missing, it allows the commit, because a hook bug must never
be the reason someone cannot commit.

The hook is a string analyzer and can be talked around (a git alias, a script
that commits). The CI check below is what holds, because it reads the commits
that actually exist.

To check the same rule in CI, for every commit a pull request adds:

```sh
git log --format='%H %(trailers:key=Spec,valueonly,separator=%x2C)' origin/main..HEAD |
  awk 'NF < 2 { print "Commit " $1 " has no Spec: trailer"; bad = 1 } END { exit bad }'
```

Keep the trailer accurate when a change outgrows its spec. A commit claiming
`Spec: 004` while implementing something 004 never described is worse than no
trailer at all, because it defeats the check without anyone noticing.
