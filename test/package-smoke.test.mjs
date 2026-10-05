import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  compile,
  createAdapterRegistry,
  loadManifest,
  validate,
  validateAdapterRegistry,
} from "../src/index.mjs";

test("public package entry point exposes the documented API", async () => {
  for (const api of [compile, validate, loadManifest, createAdapterRegistry, validateAdapterRegistry]) {
    assert.equal(typeof api, "function");
  }

  const packageFile = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageFile, "utf8"));

  assert.equal(packageJson.name, "@akinlabs/ai-engineering");
  assert.deepEqual(packageJson.bin, { aie: "bin/aie.mjs" }, "the deprecated ai binary was removed in 0.4.0");
});

test("the deprecated ai entry point is gone", async () => {
  await assert.rejects(fs.access(path.join(process.cwd(), "bin", "ai.mjs")), { code: "ENOENT" });
});
