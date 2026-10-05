# Spec 015: Harden the spec-trailer hook

- Status: **Shipped in 0.3.1**
- Priority: P1
- Target release: 0.3.1
- Depends on: Spec 009 (hook compilation), Spec 010 (workflow packs)
- Finding: the `spec-trailer` hook shipped in 0.3.0 decides with shell `case`
  globs over the raw command string. Three classes of input defeat it, and none
  of them needs intent — an agent writing an ordinary commit can hit each one.

## Problem

`packs/development/spec-driven/hooks/spec-trailer.sh` makes three string-match
decisions, and each one is wrong in a different direction:

1. **Is this a commit?** `*"git commit"*` requires the literal substring. It
   misses `git -C dir commit`, `git -c key=value commit`, `git  commit` (two
   spaces), `g"i"t commit`, and `$GIT commit`. Every one of those commits
   unchecked. (`/usr/bin/git commit` was reported too, but it contains the
   substring and was already caught; the table keeps a row for it anyway.)
2. **Does the commit reuse an existing message?** `*--amend*|*--no-edit*`
   matches anywhere, so a commit whose *message* mentions `--amend` skips the
   guard entirely.
3. **Does the message carry a trailer?** `*Spec:*` matches anywhere — in the
   subject line, in prose, in a shell comment after the command. Git does not
   consider any of those a trailer, so the commit passes the hook and then has
   no trailer for the CI check or a reviewer to find.

The rule's CI snippet repeats mistake 3: `grep -q '^Spec:'` over the whole log
accepts a `Spec:` line anywhere in any one commit body.

## Design

### Decide on structure, not substrings

The hook stays a POSIX `sh` script, and moves every decision into the `node`
program it already runs. That program:

1. **Tokenizes the command as a shell would**, for the subset that matters:
   quoting (`'…'`, `"…"`, `$'…'`), backslash escapes, comments, the separators
   `;` `&&` `||` `|` `&` and newlines, redirections, here-documents, and command
   substitution (`$(…)`, backticks). Commands inside a substitution are
   inspected too, since they run.
2. **Finds git invocations wherever they appear in a simple command**, not only
   in first position, so wrappers (`env`, `sudo`, `xargs`, `if`, `time`) need no
   list. A word is git when its basename is `git`. Git's global options are
   skipped with their arguments (`-C`, `-c`, `--git-dir`, `--work-tree`,
   `--namespace`, `--config-env`, and every flag), and the first remaining
   word is the subcommand.
3. **Parses `git commit`'s own options** to learn where the message comes from:
   `-m`/`--message` (repeatable, joined with a blank line as git does), `-F`/
   `--file` (a file, or `-` for a here-document or here-string), `--trailer`,
   `-C`/`-c`/`--reuse-message`/`--reedit-message`, `--amend`, `--no-edit`,
   `--fixup`, `--squash`, and short-option clusters such as `-am`. Option
   parsing stops at `--`. Text inside a message is never read as an option.
4. **Asks git whether the message has a `Spec:` trailer**, by piping it through
   `git interpret-trailers --parse`. The hook does not reimplement trailer
   rules; it uses the same parser that `git log --format='%(trailers)'` uses, so
   the hook and the CI check cannot disagree.

### What counts as satisfied

| The commit… | Decision |
| --- | --- |
| has an explicit message (`-m`, `-F`) whose trailers include `Spec:` with a value | allow |
| passes `--trailer "Spec: …"` or `--trailer "Spec=…"` | allow |
| reuses a message (`-C`/`-c <rev>`) whose trailers include `Spec:` | allow |
| is `--amend` or `--no-edit` with no new message | allow (the message is reused, as in 0.3.0) |
| is `--fixup` or `--squash` with no new message | allow (meant to be squashed away) |
| has an explicit message without the trailer | **block** |
| has no message source, so it would open an editor | **block** (unchanged from 0.3.0) |
| has a message the hook cannot know without running something: a variable, a substitution other than `cat` of a here-document, a file that does not exist yet, a pipe | **block**, saying the message could not be read |
| runs git with a subcommand that is not literal (`git $cmd`), or runs a non-literal program followed by `commit` (`$GIT commit`) | **block**, saying the command could not be read |
| hands a script containing `git` and `commit` to `sh -c`, `eval`, or an interpreter's eval flag (`python -c`, `node -e`, `perl -e`, `ruby -e`) | literal shell scripts are inspected recursively; anything else is **blocked** |

Blocking on an unreadable message is a deliberate change of direction. "Fail
open" in 0.3.0 meant two different things that should never have shared a
name: *the hook broke*, and *the input was hard to read*. Only the first one
fails open now. An input the hook cannot read is exactly the input an agent
that wanted around it would write, and the fix — put the message in `-m` or a
quoted here-document — costs the honest caller one rewrite.

### Fail open on internal errors, still

Every internal failure allows the commit, and each is tested:

- `node` is not on `PATH`.
- The payload is empty, is not JSON, or has no `tool_input.command`.
- `git` is not on `PATH`, or `git interpret-trailers` fails.
- The program throws.

The `sh` wrapper blocks only when the program prints an explicit decision. A
crash prints nothing, so it cannot block.

That makes a crash a bypass, so the inputs that control the program must not be
able to cause one. The parser recurses into substitutions and `sh -c` scripts,
and recursion deep enough would overflow the stack; nesting past 32 levels is
therefore refused as unreadable instead of being allowed to crash. Only the
environment (node, git, the payload Claude Code sends) can trigger the
fail-open paths.

### CI check

The rule's snippet changes to read trailers the way git does, per commit:

```sh
commits=$(git log --format='%H %(trailers:key=Spec,valueonly,separator=%x2C)' origin/main..HEAD) || exit 1
printf '%s\n' "$commits" |
  awk 'NF == 1 { print "Commit " $1 " has no Spec: trailer"; bad = 1 } END { exit bad }'
```

Every commit in the range must carry the trailer, not just one of them, and a
`git log` that fails (no `origin/main`) fails the check instead of producing no
output and passing. `test/trailer-ci.test.mjs` runs the snippet exactly as the
rule prints it.

## Known limits (stay out of scope, documented)

These are recorded so the threat model (Spec 018) can state them; none is fixed
here.

- **Git aliases.** `git ci -m …` where `ci = commit` is not recognized. Reading
  git configuration to expand aliases is possible but opens a long tail
  (`!` shell aliases, `include.path`).
- **Indirection the hook cannot see:** a script file (`./commit.sh`), a
  `Makefile` target, a git hook of its own.
- **False positives** for commands that mention git without running it, such
  as `echo git commit`. Blocking an `echo` costs a rewrite; missing a commit
  costs the guarantee.
- **The hook is a string analyzer**, however careful. It narrows the gap; the CI
  check is what closes it, because CI reads the commits that actually exist.

## Tests

`test/adversarial.test.mjs` drives the real script with Claude Code's hook
payload on stdin and asserts exit status 2 (block) or 0 (allow). It is a table:
one row per attempt, each labelled with the bypass it exercises. The table is
committed failing before the fix.

`test/workflow.test.mjs` keeps covering how the hook is compiled and shipped.

## Done when

- Every row in the adversarial table passes on Node 20, 22, and 24, under both
  bash-as-`sh` (macOS) and dash (Debian and Ubuntu, where CI runs).
- The 0.3.0 bypasses (1–3 above) each have at least one row that fails against
  the 0.3.0 script.
- Each fail-open path has a row.
- The rule's CI snippet is the trailer-aware version.
- `CHANGELOG.md` has a 0.3.1 section.
