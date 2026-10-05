import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { projectRoot } from "./helpers.mjs";

/**
 * The spec-trailer rule ships a CI snippet that users paste into their
 * pipelines. It is the check that holds when the hook is talked around, so it
 * is run here exactly as the rule prints it.
 */

const RULE = path.join(projectRoot, "packs/development/spec-driven/rules/spec-trailer.md");

async function snippet() {
  const text = await fs.readFile(RULE, "utf8");
  const match = /```sh\n([\s\S]*?)```/.exec(text);

  assert.ok(match, "the rule contains a sh snippet");
  return match[1];
}

async function withRepository(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-engineering-trailer-ci-"));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };

  try {
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "Base");
    await run({ root, git });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function check(root) {
  const result = spawnSync("sh", ["-c", await snippet()], { cwd: root, encoding: "utf8" });

  return { code: result.status, output: result.stdout + result.stderr };
}

test("passes when every commit in the range has a trailer", async () => {
  await withRepository(async ({ root, git }) => {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "One", "-m", "Spec: 015");
    git("commit", "-q", "--allow-empty", "-m", "Two", "-m", "Spec: none — refactor");

    assert.equal((await check(root)).code, 0);
  });
});

test("fails when any one commit lacks a trailer, even if it mentions Spec: in prose", async () => {
  await withRepository(async ({ root, git }) => {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "One", "-m", "Spec: 015");
    git("commit", "-q", "--allow-empty", "-m", "Two", "-m", "This mentions Spec: 015 in prose.");

    const result = await check(root);

    assert.equal(result.code, 1);
    assert.match(result.output, /has no Spec: trailer/);
  });
});

test("passes on an empty range", async () => {
  await withRepository(async ({ root, git }) => {
    git("update-ref", "refs/remotes/origin/main", "HEAD");

    assert.equal((await check(root)).code, 0);
  });
});

test("fails when git log fails, rather than passing on no output", async () => {
  await withRepository(async ({ root }) => {
    // No origin/main: the range cannot be resolved.
    assert.notEqual((await check(root)).code, 0);
  });
});
