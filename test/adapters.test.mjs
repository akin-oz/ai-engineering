import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { render as renderClaude } from "../src/adapters/claude.mjs";
import { render as renderCodex } from "../src/adapters/codex.mjs";
import { fileExists, makeWorkspace } from "./helpers.mjs";

function adapterManifest(workspace) {
  const files = {
    agents: path.join(workspace.ai, "agents"),
    rules: path.join(workspace.ai, "rules"),
    hooks: path.join(workspace.ai, "hooks"),
    commands: path.join(workspace.ai, "commands"),
    templates: path.join(workspace.ai, "templates"),
  };

  return {
    files,
    agents: ["architect"],
    rules: ["engineering"],
    resolve: {
      agent: (name) => path.join(files.agents, `${name}.md`),
      rule: (name) => path.join(files.rules, `${name}.md`),
      output: (id) => path.join(workspace.root, `.${id}`),
    },
  };
}

test("Claude adapter copies source directories and removes stale output", async () => {
  const workspace = await makeWorkspace({
    agents: { "architect.md": "architect" },
    rules: { "engineering.md": "engineering" },
  });

  try {
    const manifest = adapterManifest(workspace);
    await renderClaude(manifest);

    await fs.writeFile(path.join(workspace.root, ".claude", "stale.txt"), "stale");
    await renderClaude(manifest);

    assert.equal(await fs.readFile(path.join(workspace.root, ".claude", "agents", "architect.md"), "utf8"), "architect");
    assert.equal(await fileExists(path.join(workspace.root, ".claude", "stale.txt")), false);
  } finally {
    await workspace.cleanup();
  }
});

test("Codex adapter renders deterministic ordered Markdown and removes stale output", async () => {
  const workspace = await makeWorkspace({
    agents: { "architect.md": "architect" },
    rules: { "engineering.md": "engineering" },
    templates: { "codex-agents.md": "{{RULES}}\n{{AGENTS}}\n" },
  });

  try {
    const manifest = adapterManifest(workspace);
    await renderCodex(manifest);
    const output = path.join(workspace.root, ".codex", "AGENTS.md");
    const first = await fs.readFile(output);
    const firstHash = crypto.createHash("sha256").update(first).digest("hex");

    await fs.writeFile(path.join(workspace.root, ".codex", "stale.txt"), "stale");
    await renderCodex(manifest);

    const second = await fs.readFile(output);
    const secondHash = crypto.createHash("sha256").update(second).digest("hex");

    assert.equal(firstHash, secondHash);
    assert.equal(await fileExists(path.join(workspace.root, ".codex", "stale.txt")), false);
    assert.match(second.toString(), /## Rule: engineering[\s\S]*## Agent: architect/);
  } finally {
    await workspace.cleanup();
  }
});
