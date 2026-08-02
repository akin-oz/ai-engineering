import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAdapterRegistry,
  validateAdapterRegistry,
} from "../src/registry.mjs";
import { DiagnosticError } from "../src/diagnostics.mjs";

test("discovers and validates adapter modules", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-adapters-"));

  try {
    await fs.writeFile(path.join(directory, "example.mjs"), [
      "export const id = 'example';",
      "export async function render() { return { files: 0 }; }",
    ].join("\n"));

    const registry = await createAdapterRegistry(directory);

    assert.equal(registry.length, 1);
    assert.equal(registry[0].id, "example");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate adapter IDs", () => {
  assert.throws(
    () => validateAdapterRegistry([
      { id: "duplicate", render() {} },
      { id: "duplicate", render() {} },
    ]),
    (error) => error instanceof DiagnosticError && error.message.includes("Duplicate adapter")
  );
});

test("rejects malformed adapters", () => {
  assert.throws(
    () => validateAdapterRegistry([{ id: "invalid" }]),
    (error) => error instanceof DiagnosticError && error.message.includes("render")
  );
});
