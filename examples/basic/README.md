# Basic example

This example shows the complete source-to-runtime workflow:

    .ai/                    source intent
            ↓ ai sync
    .claude/ and .codex/    generated artifacts

The source workspace contains one rule and one agent:

- .ai/rules/concise.md
- .ai/agents/reviewer.md

The generated outputs preserve the same intent in each runtime's format:

- .claude/rules/concise.md and .claude/agents/reviewer.md
- .codex/AGENTS.md

From the repository root, validate and compile the example with:

    cd examples/basic
    node ../../bin/ai.mjs validate
    node ../../bin/ai.mjs sync

The generated directories are committed so the result can be inspected
without running the compiler. They should be regenerated after changing files
under .ai/.
