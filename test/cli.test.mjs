import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };
import { bin, makeWorkspace, projectRoot } from "./helpers.mjs";

function runCli(args, cwd = projectRoot, command = bin) {
  return spawnSync(process.execPath, [command, ...args], { cwd, encoding: "utf8" });
}

test("CLI prints help and version", () => {
  const help = runCli(["--help"]);
  const version = runCli(["--version"]);

  assert.equal(help.status, 0);
  assert.match(help.stdout, /aie init/);
  assert.match(help.stdout, /aie sync/);
  assert.match(help.stdout, /aie check/);
  assert.equal(version.status, 0);
  assert.equal(version.stdout, `${packageJson.version}\n`);
});

test("the deprecated ai command still runs and warns", () => {
  const result = runCli(["--version"], projectRoot, path.join(projectRoot, "bin", "ai.mjs"));

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.match(result.stderr, /deprecated/);
});

test("CLI guides users when sync runs without a workspace", async () => {
  const workspace = await makeWorkspace();

  try {
    await fs.rm(path.join(workspace.ai, "manifest.yaml"));
    const result = runCli(["sync"], workspace.root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No AI workspace found/);
    assert.match(result.stderr, /aie init/);
    assert.doesNotMatch(result.stderr, /manifest\.mjs/);
  } finally {
    await workspace.cleanup();
  }
});

test("CLI validates a workspace and reports unknown input consistently", async () => {
  const workspace = await makeWorkspace();

  try {
    const valid = runCli(["validate"], workspace.root);
    const unknownCommand = runCli(["unknown"], workspace.root);
    const unknownOption = runCli(["sync", "--nope"], workspace.root);

    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /workspace is valid/);
    assert.equal(unknownCommand.status, 1);
    assert.match(unknownCommand.stderr, /^Error: Unknown command/);
    assert.equal(unknownOption.status, 1);
    assert.match(unknownOption.stderr, /^Error: Unknown option/);
  } finally {
    await workspace.cleanup();
  }
});

test("errors are machine readable with --json", async () => {
  const workspace = await makeWorkspace({ manifest: "version: 1\nagents:\n  - missing\n" });

  try {
    const result = runCli(["sync", "--json"], workspace.root);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.diagnostics[0].code, "source-missing");
  } finally {
    await workspace.cleanup();
  }
});
