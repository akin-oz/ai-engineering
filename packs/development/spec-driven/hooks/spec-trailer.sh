#!/bin/sh
# Refuses a `git commit` that does not say which spec it implements.
#
# The spec-driven workflow says behavior changes start from a written spec. A
# commit trailer is what makes that checkable afterwards, by a reviewer or by
# CI, rather than remembered:
#
#     Spec: 004
#     Spec: none — refactor, no behavior change
#
# Reads the Claude Code hook payload on stdin and inspects the Bash command.
# Fails open: anything unexpected allows the commit, because a hook bug must
# never be the reason someone cannot commit.

set -u

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0

command_line="$(
  printf '%s' "$payload" |
    node -e '
      let raw = "";
      process.stdin.on("data", (chunk) => { raw += chunk; });
      process.stdin.on("end", () => {
        try {
          process.stdout.write(JSON.parse(raw)?.tool_input?.command ?? "");
        } catch {
          process.stdout.write("");
        }
      });
    ' 2>/dev/null
)" || exit 0

# Only guard commits that actually record a message here.
case "$command_line" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

case "$command_line" in
  *--amend*|*--no-edit*) exit 0 ;;
esac

case "$command_line" in
  *Spec:*) exit 0 ;;
esac

cat >&2 <<'MESSAGE'
This commit does not say which spec it implements.

Add a trailer to the commit message:

    Spec: 004                        the spec this change implements
    Spec: none — refactor            no behavior change, so no spec is needed

If the behavior change has no spec yet, write the spec first — that is the
workflow this repository selected.
MESSAGE

exit 2
