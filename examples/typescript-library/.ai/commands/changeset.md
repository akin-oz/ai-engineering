Write a changeset for the current branch.

Read the diff since the base branch, decide whether the change is patch, minor,
or major from the consumer's perspective, and write the entry describing impact
rather than implementation. If the change touches an exported signature, include
a before-and-after line showing what callers must change.

State your reasoning for the version bump in one sentence, so a reviewer can
disagree with the judgment rather than only the wording.
