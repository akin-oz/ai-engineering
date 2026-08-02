import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  assert.match(help.stdout, /ai sync/);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^0\.1\.0\n$/);
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
