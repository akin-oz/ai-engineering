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

const adapter = (overrides = {}) => ({ id: "example", render() {}, ...overrides });

test("discovers and validates adapter modules", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-adapters-"));

  try {
    await fs.writeFile(path.join(directory, "example.mjs"), [
      "export const id = 'example';",
      "export const surface = { version: 1, artifacts: [",
      "  { id: 'root', kind: 'file', path: 'EXAMPLE.md' },",
      "] };",
      "export async function render() { return { files: [] }; }",
    ].join("\n"));

    const registry = await createAdapterRegistry(directory);

    assert.equal(registry.length, 1);
    assert.equal(registry[0].id, "example");
    assert.equal(registry[0].surface.artifacts[0].path, "EXAMPLE.md");
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

test("an adapter without a surface is still valid", () => {
  assert.equal(validateAdapterRegistry([adapter()]).length, 1);
});

test("rejects surfaces that could escape the project or overwrite sources", () => {
  const cases = [
    ["../outside.md", /inside the project root/],
    ["/etc/passwd", /relative to the project root/],
    [".ai/manifest.yaml", /must not write into the \.ai source workspace/],
  ];

  for (const [artifactPath, expected] of cases) {
    assert.throws(
      () => validateAdapterRegistry([adapter({
        surface: { version: 1, artifacts: [{ id: "root", kind: "file", path: artifactPath }] },
      })]),
      (error) => error instanceof DiagnosticError && expected.test(error.message),
      `expected "${artifactPath}" to be rejected`
    );
  }
});

test("rejects malformed surface declarations", () => {
  const cases = [
    [{ version: 1 }, /artifacts array/],
    [{ artifacts: [] }, /numeric version/],
    [{ version: 1, artifacts: [{ id: "a", kind: "socket", path: "a" }] }, /kind "file" or "directory"/],
    [
      {
        version: 1,
        artifacts: [
          { id: "a", kind: "file", path: "SAME.md" },
          { id: "b", kind: "file", path: "SAME.md" },
        ],
      },
      /twice/,
    ],
  ];

  for (const [surface, expected] of cases) {
    assert.throws(
      () => validateAdapterRegistry([adapter({ surface })]),
      (error) => error instanceof DiagnosticError && expected.test(error.message)
    );
  }
});
