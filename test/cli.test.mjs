import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { makeWorkspace } from "./helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(projectRoot, "bin", "ai.mjs");

function runCli(args, cwd = projectRoot) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("CLI prints help and version", () => {
  const help = runCli(["--help"]);
  const version = runCli(["--version"]);

  assert.equal(help.status, 0);
  assert.match(help.stdout, /ai init/);
  assert.match(help.stdout, /ai sync/);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^0\.1\.2\n$/);
});

test("CLI guides users when sync runs without a workspace", async () => {
  const workspace = await makeWorkspace();

  try {
    await fs.rm(path.join(workspace.ai, "manifest.yaml"));
    const result = runCli(["sync"], workspace.root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No AI workspace found/);
    assert.match(result.stderr, /ai init/);
    assert.doesNotMatch(result.stderr, /manifest\.mjs/);
  } finally {
    await workspace.cleanup();
  }
});

test("CLI validates a workspace and reports unknown commands consistently", async () => {
  const workspace = await makeWorkspace();

  try {
    const valid = runCli(["validate"], workspace.root);
    const invalid = runCli(["unknown"], workspace.root);

    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /workspace is valid/);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /^Error: Unknown command/);
  } finally {
    await workspace.cleanup();
  }
});
