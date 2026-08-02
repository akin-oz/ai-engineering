import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fail } from "./diagnostics.mjs";

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

    ids.add(adapter.id);
  }

  return Object.freeze([...registry]);
}

function normalizeAdapter(module, file) {
  const adapter = {
    id: module.id ?? module.default?.id,
    render: module.render ?? module.default?.render,
  };

  try {
    return validateAdapterRegistry([adapter])[0];
  } catch (error) {
    if (error.details) {
      throw error;
    }

    fail(error.message, { file });
  }
}
