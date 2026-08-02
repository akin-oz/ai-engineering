import assert from "node:assert/strict";
import test from "node:test";

import { DiagnosticError } from "../src/diagnostics.mjs";
import { loadManifest } from "../src/manifest/load.mjs";
import { makeWorkspace } from "./helpers.mjs";

test("loads an immutable manifest and preserves declared order", async () => {
  const workspace = await makeWorkspace({
    manifest: [
      "version: 1",
      "targets:",
      "  codex:",
      "    enabled: true",
      "agents:",
      "  - second",
      "  - first",
      "  - second",
      "rules:",
      "  - security",
      "",
    ].join("\n"),
    agents: {
      "first.md": "first",
      "second.md": "second",
    },
    rules: {
      "security.md": "security",
    },
  });

  try {
    const manifest = await loadManifest(workspace.root);

    assert.deepEqual(manifest.agents, ["second", "first"]);
    assert.equal(manifest.rules[0], "security");
    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(manifest.resolve.output("codex"), `${workspace.root}/.codex`);
  } finally {
    await workspace.cleanup();
  }
});

test("rejects unsafe target output paths", async () => {
  const workspace = await makeWorkspace({
    manifest: [
      "version: 1",
      "targets:",
      "  codex:",
      "    output: ../outside",
      "",
    ].join("\n"),
  });

  try {
    await assert.rejects(
      loadManifest(workspace.root),
      (error) => error instanceof DiagnosticError && /relative path|inside/.test(error.message)
    );
  } finally {
    await workspace.cleanup();
  }
});

test("rejects manifest references to missing source files", async () => {
  const workspace = await makeWorkspace({
    manifest: [
      "version: 1",
      "agents:",
      "  - missing",
      "",
    ].join("\n"),
  });

  try {
    await assert.rejects(
      loadManifest(workspace.root),
      (error) => error instanceof DiagnosticError && error.message.includes("Unknown agent")
    );
  } finally {
    await workspace.cleanup();
  }
});
