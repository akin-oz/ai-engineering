import assert from "node:assert/strict";
import test from "node:test";

import { render } from "../src/adapters/cursor.mjs";
import { loadManifest } from "../src/manifest/load.mjs";
import { initializedRepository, makeWorkspace } from "./helpers.mjs";

const MANIFEST = [
  "version: 1",
  "targets:",
  "  cursor:",
  "    enabled: true",
  "agents:",
  "  - reviewer",
  "rules:",
  "  - scoped",
  "  - plain",
  "",
].join("\n");

async function fixture() {
  const workspace = await makeWorkspace({
    manifest: MANIFEST,
    agents: { "reviewer.md": "You review code.\n" },
    rules: {
      "scoped.md": "---\ndescription: TypeScript rules\nscope: src/**/*.ts\n---\n\nUse named exports.\n",
      "plain.md": "Prefer small changes over large ones.\n\nMore detail follows here.\n",
    },
  });

  return { workspace, manifest: await loadManifest(workspace.root) };
}

test("a scoped rule becomes a globbed Cursor rule", async () => {
  const { workspace, manifest } = await fixture();

  try {
    const { files } = await render(manifest);
    const scoped = files.find((file) => file.path.endsWith("scoped.mdc"));

    assert.equal(scoped.path, ".cursor/rules/scoped.mdc");
    assert.match(scoped.contents, /^---\ndescription: TypeScript rules\nglobs: src\/\*\*\/\*\.ts\nalwaysApply: false\n---\n/);
    assert.match(scoped.contents, /Use named exports\./);
    assert.doesNotMatch(scoped.contents, /^---[\s\S]*---[\s\S]*---/, "frontmatter is not duplicated");
  } finally {
    await workspace.cleanup();
  }
});

test("a rule without scope always applies and gets a derived description", async () => {
  const { workspace, manifest } = await fixture();

  try {
    const { files } = await render(manifest);
    const plain = files.find((file) => file.path.endsWith("plain.mdc"));

    assert.match(plain.contents, /alwaysApply: true/);
    assert.match(plain.contents, /description: Prefer small changes over large ones\./);
    assert.doesNotMatch(plain.contents, /globs:/);
  } finally {
    await workspace.cleanup();
  }
});

test("cursor reports the sources it cannot express", async () => {
  const { workspace, manifest } = await fixture();

  try {
    const { diagnostics } = await render(manifest);
    const unsupported = diagnostics.find((entry) => entry.code === "capability-unsupported");

    assert.equal(unsupported.severity, "info");
    assert.match(unsupported.message, /agent format, so "reviewer"/);
  } finally {
    await workspace.cleanup();
  }
});

test("three runtimes compile the same sources from one workspace", async () => {
  const repository = await initializedRepository();

  try {
    await repository.write(".ai/rules/testing.md", "Run the suite before merging.\n");
    await repository.write(".ai/manifest.yaml", [
      "version: 1",
      "targets:",
      "  claude:",
      "    enabled: true",
      "  codex:",
      "    enabled: true",
      "  cursor:",
      "    enabled: true",
      "agents: []",
      "rules:",
      "  - project",
      "  - testing",
      "",
    ].join("\n"));

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const claude = await repository.read("CLAUDE.md");
    const agents = await repository.read("AGENTS.md");

    for (const rule of ["project", "testing"]) {
      assert.match(claude, new RegExp(`## Rule: ${rule}`));
      assert.match(agents, new RegExp(`## Rule: ${rule}`));
      assert.equal(await repository.exists(`.cursor/rules/${rule}.mdc`), true);
    }

    assert.equal(repository.run("check").code, 0);
  } finally {
    await repository.cleanup();
  }
});
