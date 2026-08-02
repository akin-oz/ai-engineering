import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { initializeWorkspace } from "../src/workspace/init.mjs";
import { makeWorkspace } from "./helpers.mjs";

test("init creates a minimal workspace", async () => {
  const workspace = await makeWorkspace({ manifest: "" });

  try {
    await fs.rm(workspace.ai, { recursive: true, force: true });
    const result = await initializeWorkspace(workspace.root);

    assert.deepEqual(result.created, [
      ".ai/",
      ".ai/manifest.yaml",
      ".ai/agents/",
      ".ai/rules/",
      ".ai/templates/",
      ".ai/templates/codex-agents.md",
    ]);
    assert.match(
      await fs.readFile(path.join(workspace.ai, "manifest.yaml"), "utf8"),
      /^schema: 1/m
    );
  } finally {
    await workspace.cleanup();
  }
});

test("init is idempotent and never overwrites existing files", async () => {
  const workspace = await makeWorkspace({ manifest: "existing: true\n" });

  try {
    for (const directory of ["agents", "rules", "templates"]) {
      await fs.rm(path.join(workspace.ai, directory), { recursive: true, force: true });
    }

    const first = await initializeWorkspace(workspace.root);
    const second = await initializeWorkspace(workspace.root);

    assert.deepEqual(first.created, [
      ".ai/agents/",
      ".ai/rules/",
      ".ai/templates/",
      ".ai/templates/codex-agents.md",
    ]);
    assert.deepEqual(second.created, []);
    assert.equal(
      await fs.readFile(path.join(workspace.ai, "manifest.yaml"), "utf8"),
      "existing: true\n"
    );
  } finally {
    await workspace.cleanup();
  }
});
