import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fail } from "./diagnostics.mjs";

const ARTIFACT_KINDS = new Set(["file", "directory"]);

export async function createAdapterRegistry(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const adapters = [];

  for (const entry of entries
    .filter((item) => item.isFile() && item.name.endsWith(".mjs"))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    const module = await import(pathToFileURL(file).href);
    const adapter = normalizeAdapter(module, file);

    if (adapters.some((item) => item.id === adapter.id)) {
      fail(`Duplicate adapter id "${adapter.id}"`, { file });
    }

    adapters.push(adapter);
  }

  return validateAdapterRegistry(adapters);
}

export function validateAdapterRegistry(registry) {
  if (!Array.isArray(registry)) {
    fail("Adapter registry must be an array");
  }

  const ids = new Set();

  for (const adapter of registry) {
    if (typeof adapter?.id !== "string" || !adapter.id.trim()) {
      fail("Adapter must export a non-empty id");
    }

    if (typeof adapter.render !== "function") {
      fail(`Adapter "${adapter.id}" must export render(manifest)`);
    }

    if (ids.has(adapter.id)) {
      fail(`Duplicate adapter id "${adapter.id}"`);
    }

    validateSurface(adapter);
    ids.add(adapter.id);
  }

  return Object.freeze([...registry]);
}

function validateSurface(adapter) {
  const { surface } = adapter;

  if (surface === undefined) {
    return;
  }

  if (!isObject(surface) || !Array.isArray(surface.artifacts)) {
    fail(`Adapter "${adapter.id}" surface must declare an artifacts array`);
  }

  if (typeof surface.version !== "number") {
    fail(`Adapter "${adapter.id}" surface must declare a numeric version`);
  }

  const paths = new Set();

  for (const artifact of surface.artifacts) {
    if (!isObject(artifact) || typeof artifact.id !== "string" || !artifact.id.trim()) {
      fail(`Adapter "${adapter.id}" declares an artifact without an id`);
    }

    if (!ARTIFACT_KINDS.has(artifact.kind)) {
      fail(
        `Adapter "${adapter.id}" artifact "${artifact.id}" must declare kind "file" or "directory"`
      );
    }

    if (artifact.merge !== undefined && typeof artifact.merge !== "boolean") {
      fail(`Adapter "${adapter.id}" artifact "${artifact.id}" merge must be a boolean`);
    }

    if (artifact.merge && artifact.kind !== "file") {
      fail(`Adapter "${adapter.id}" artifact "${artifact.id}" can only merge into a file`);
    }

    assertManagedPath(artifact.path, `Adapter "${adapter.id}" artifact "${artifact.id}"`);

    if (paths.has(artifact.path)) {
      fail(`Adapter "${adapter.id}" declares "${artifact.path}" twice`);
    }

    paths.add(artifact.path);
  }
}

/**
 * Managed paths are relative to the project root, cannot escape it, and can
 * never point into the source workspace the compiler reads from.
 */
export function assertManagedPath(value, subject, options = {}) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${subject} must declare a path`);
  }

  if (path.isAbsolute(value)) {
    fail(`${subject} path "${value}" must be relative to the project root`);
  }

  const normalized = path.normalize(value);

  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    fail(`${subject} path "${value}" must stay inside the project root`);
  }

  // Only the workspace itself may write into `.ai/generated/`; adapters never
  // write into the source tree they read from.
  const generated = path.join(".ai", "generated");

  if (options.allowGenerated && normalized.startsWith(`${generated}${path.sep}`)) {
    return normalized;
  }

  if (normalized === ".ai" || normalized.startsWith(`.ai${path.sep}`)) {
    fail(`${subject} path "${value}" must not write into the .ai source workspace`);
  }

  return normalized;
}

function normalizeAdapter(module, file) {
  const adapter = {
    id: module.id ?? module.default?.id,
    render: module.render ?? module.default?.render,
    surface: module.surface ?? module.default?.surface,
    capabilities: module.capabilities ?? module.default?.capabilities,
  };

  try {
    return validateAdapterRegistry([adapter])[0];
  } catch (error) {
    if (error.diagnostics) {
      throw error;
    }

    fail(error.message, { file });
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
