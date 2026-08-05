import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { initializeWorkspace } from "../src/workspace/init.mjs";
import { makeWorkspace } from "./helpers.mjs";

const EXPECTED = [
  ".ai/",
  ".ai/manifest.yaml",
  ".ai/agents/",
  ".ai/rules/",
  ".ai/commands/",
  ".ai/templates/",
  ".ai/rules/project.md",
  ".ai/templates/claude.md",
  ".ai/templates/agents.md",
];

test("init seeds a workspace that compiles to real content", async () => {
  const workspace = await makeWorkspace({ manifest: "" });

  try {
    await fs.rm(workspace.ai, { recursive: true, force: true });
    const result = await initializeWorkspace(workspace.root);

    assert.deepEqual(result.created, EXPECTED);

    const manifest = await fs.readFile(path.join(workspace.ai, "manifest.yaml"), "utf8");

    assert.match(manifest, /^version: 1/m);
    assert.match(manifest, /^rules:\n {2}- project$/m, "the seeded rule is listed");

    const rule = await fs.readFile(path.join(workspace.ai, "rules", "project.md"), "utf8");

    assert.ok(rule.trim().length > 0, "the seeded rule is never empty");

    for (const template of ["claude.md", "agents.md"]) {
      const contents = await fs.readFile(path.join(workspace.ai, "templates", template), "utf8");
      // The authoring note mentions the placeholder, so assert on the body only:
      // a template whose note survives but whose placeholder does not compiles
      // to an empty runtime file.
      const body = contents.replace(/<!--[\s\S]*?-->/g, "");

      assert.match(body, /\{\{RULES\}\}/, `${template} keeps its rules placeholder`);
    }
  } finally {
    await workspace.cleanup();
  }
});

test("init is idempotent and never overwrites existing files", async () => {
  const workspace = await makeWorkspace({ manifest: "existing: true\n" });

  try {
    for (const directory of ["agents", "rules", "commands", "templates"]) {
      await fs.rm(path.join(workspace.ai, directory), { recursive: true, force: true });
    }

    const first = await initializeWorkspace(workspace.root);
    const second = await initializeWorkspace(workspace.root);

    assert.deepEqual(first.created, EXPECTED.slice(2));
    assert.deepEqual(second.created, []);
    assert.equal(
      await fs.readFile(path.join(workspace.ai, "manifest.yaml"), "utf8"),
      "existing: true\n"
    );
  } finally {
    await workspace.cleanup();
  }
});

test("init reports existing runtime files that sync will not overwrite", async () => {
  const workspace = await makeWorkspace({ manifest: "" });

  try {
    await fs.rm(workspace.ai, { recursive: true, force: true });
    await fs.writeFile(path.join(workspace.root, "CLAUDE.md"), "hand written\n");

    const result = await initializeWorkspace(workspace.root);

    assert.deepEqual(result.existingRuntimeFiles, ["CLAUDE.md"]);
  } finally {
    await workspace.cleanup();
  }
});
