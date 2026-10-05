import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { initializedRepository, projectRoot } from "./helpers.mjs";

/**
 * The GitHub Action's interface is its exit code and the workflow commands it
 * prints (`::error file=…::`), so those are what these tests assert on.
 */

const SCRIPT = path.join(projectRoot, "scripts", "github-check.mjs");

function runAction(repository, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: repository.root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTION_PATH: projectRoot, GITHUB_STEP_SUMMARY: "", ...env },
  });

  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function withSyncedRepository(run) {
  const repository = await initializedRepository();

  try {
    assert.equal(repository.run("sync").code, 0);
    await run(repository);
  } finally {
    await repository.cleanup();
  }
}

test("audit=warn annotates findings as warnings and does not fail", async () => {
  await withSyncedRepository(async (repository) => {
    await repository.write(".env", "A=1\n");

    const result = runAction(repository, { AIE_AUDIT: "warn" });

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /::warning file=\.env::.*secret-readable/);
    assert.doesNotMatch(result.stdout, /::error/);
  });
});

test("audit defaults to warn", async () => {
  await withSyncedRepository(async (repository) => {
    const result = runAction(repository);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /::warning::.*deny-empty/);
  });
});

test("audit=fail annotates error findings as errors and fails the job", async () => {
  await withSyncedRepository(async (repository) => {
    await repository.write(".env", "A=1\n");

    const result = runAction(repository, { AIE_AUDIT: "fail", AIE_STRICT: "false" });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /::error file=\.env::.*secret-readable/);
    assert.match(result.stdout, /::warning::.*deny-empty/);
  });
});

test("audit=fail with strict fails on warnings alone", async () => {
  await withSyncedRepository(async (repository) => {
    assert.equal(runAction(repository, { AIE_AUDIT: "fail", AIE_STRICT: "false" }).code, 0);
    assert.equal(runAction(repository, { AIE_AUDIT: "fail", AIE_STRICT: "true" }).code, 1);
  });
});

test("audit=off does not run the audit", async () => {
  await withSyncedRepository(async (repository) => {
    await repository.write(".env", "A=1\n");

    const result = runAction(repository, { AIE_AUDIT: "off" });

    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /secret-readable|deny-empty/);
  });
});

test("drift still fails the job whatever the audit says", async () => {
  await withSyncedRepository(async (repository) => {
    await repository.write("CLAUDE.md", "edited by hand\n");

    const result = runAction(repository, { AIE_AUDIT: "warn" });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /::error file=CLAUDE\.md::/);
  });
});
