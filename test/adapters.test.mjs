import assert from "node:assert/strict";
import test from "node:test";

import { render as renderClaude } from "../src/adapters/claude.mjs";
import { render as renderCodex } from "../src/adapters/codex.mjs";
import { loadManifest } from "../src/manifest/load.mjs";
import { makeWorkspace } from "./helpers.mjs";

const MANIFEST = [
  "version: 1",
  "targets:",
  "  claude:",
  "    enabled: true",
  "  codex:",
  "    enabled: true",
  "agents:",
  "  - architect",
  "rules:",
  "  - engineering",
  "commands:",
  "  - review",
  "",
].join("\n");

async function fixture() {
  const workspace = await makeWorkspace({
    manifest: MANIFEST,
    agents: { "architect.md": "---\ndescription: architect\n---\nDesign the system.\n" },
    rules: { "engineering.md": "Keep changes small.\n" },
    commands: { "review.md": "Review the diff.\n" },
    templates: { "agents.md": "{{RULES}}\n\n---\n\n{{AGENTS}}\n" },
  });

  return { workspace, manifest: await loadManifest(workspace.root) };
}

test("Claude adapter generates root instructions plus agent and command files", async () => {
  const { workspace, manifest } = await fixture();

  try {
    const result = await renderClaude(manifest);
    const paths = result.files.map((file) => file.path);

    assert.deepEqual(paths, [
      "CLAUDE.md",
      ".claude/agents/architect.md",
      ".claude/commands/review.md",
    ]);

    const instructions = result.files[0].contents;

    assert.match(instructions, /## Rule: engineering/);
    assert.match(instructions, /Keep changes small/);

    assert.equal(
      result.files[1].contents,
      "---\ndescription: architect\n---\nDesign the system.\n",
      "agent frontmatter reaches the runtime untouched"
    );
  } finally {
    await workspace.cleanup();
  }
});

test("Codex adapter renders one root file in manifest order", async () => {
  const { workspace, manifest } = await fixture();

  try {
    const result = await renderCodex(manifest);

    assert.deepEqual(result.files.map((file) => file.path), ["AGENTS.md"]);

    const document = result.files[0].contents;

    assert.match(document, /## Rule: engineering[\s\S]*## Agent: architect/);
    assert.doesNotMatch(document, /description: architect/, "frontmatter is stripped when inlined");

    const unsupported = result.diagnostics.find((entry) => entry.code === "capability-unsupported");

    assert.equal(unsupported.severity, "info");
    assert.match(unsupported.message, /command "review"/);
  } finally {
    await workspace.cleanup();
  }
});

test("adapters are pure: rendering twice yields identical output and writes nothing", async () => {
  const { workspace, manifest } = await fixture();

  try {
    const first = await renderClaude(manifest);
    const second = await renderClaude(manifest);

    assert.deepEqual(first.files, second.files);
    assert.equal(await workspaceHasOutput(workspace.root), false);
  } finally {
    await workspace.cleanup();
  }
});

async function workspaceHasOutput(root) {
  const { fileExists } = await import("./helpers.mjs");

  return await fileExists(`${root}/CLAUDE.md`) || await fileExists(`${root}/.claude`);
}
