# Why not just…?

Honest comparisons, including where the alternative wins. Most repositories do
not need this tool.

## …symlink CLAUDE.md to AGENTS.md?

```sh
ln -s AGENTS.md CLAUDE.md
```

**Wins when** your instructions are one file of prose that both assistants
should read identically. Zero dependencies, zero build step, nothing to learn.
If that is your situation, do this instead.

**Breaks down when** the runtimes need different *shapes* of the same intent.
Claude Code loads subagents from `.claude/agents/` and slash commands from
`.claude/commands/`; a symlink cannot turn one document into a directory of
files, and it cannot leave a section out of the runtime that has no way to
express it. It also gives you no way to notice when someone edits the generated
side.

## …use AGENTS.md, the standard?

[AGENTS.md](https://agents.md) is an open standard read natively by Codex,
Cursor, Copilot, Gemini CLI, Aider, Windsurf, and Zed. It is the right default
for project instructions, and it is winning.

This tool is not an alternative to it — it *generates* a standard-compliant
`AGENTS.md`. The gap it targets is everything the standard does not cover:
subagent definitions, slash commands, and (later) hooks, which remain
per-runtime formats with no shared spec. If plain prose rules are all you need,
write an `AGENTS.md` by hand and stop here.

## …use rulesync or another rules-sync tool?

[rulesync](https://github.com/dyoshikawa/rulesync) and similar tools solve the
same surface problem and **support far more runtimes** — twenty-plus against two
here. If breadth of tool support is your requirement, they win today.

Where this compiler differs:

- **It refuses to destroy files it did not create.** Ownership is tracked per
  file; a pre-existing `.claude/settings.json` or hand-written command survives
  every sync, and anything unowned is reported rather than overwritten.
- **Nothing is dropped silently.** A source a runtime cannot express produces a
  diagnostic naming it, every run.
- **`aie check` is a real CI gate.** It detects drift without writing to the
  tree, and separates "run sync" (exit 1) from "your workspace is broken"
  (exit 2).

Those are bets, not established advantages. Judge them against your own
tolerance for a two-runtime tool.

## …use a template repository or git submodule?

**Wins when** you are distributing a whole engineering setup across many repos
and already have the tooling. Submodules pin a version, which templates cannot.

**Breaks down** on updates: a template is copied once and drifts immediately,
and a submodule cannot adapt its contents to each runtime's format. Neither
tells you when the copy has diverged from the source.

## …just maintain both files by hand?

**Wins** for a small repository with a handful of instructions. The README says
this plainly, and it is the honest answer for most projects.

**Breaks down** when the same policy exists in four or five generated places.
The failure is quiet: someone tightens a rule in one file, nothing errors, and
the assistants start giving different advice depending on which one you opened.
The point of compiling is not hiding files — it is reviewing intent once and
letting CI catch the drift.
