import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createAdapterRegistry,
  validateAdapterRegistry,
} from "../registry.mjs";
import { fail } from "../diagnostics.mjs";
import { loadManifest } from "../manifest/load.mjs";

const BUILT_IN_ADAPTERS = new URL("../adapters/", import.meta.url);

export async function compile(options = {}) {
  const { manifest, registry } = await prepare(options);
  const enabled = registry.filter((adapter) => isEnabled(manifest, adapter));
  const targets = await Promise.all(enabled.map(async (adapter) => ({
    id: adapter.id,
    ...(await adapter.render(manifest)),
  })));

  return { manifest, targets };
}

export async function validate(options = {}) {
  return prepare(options);
}

async function prepare(options) {
  const manifest = options.manifest ?? await loadManifest(options.root ?? process.cwd());
  const registry = options.registry ?? await createAdapterRegistry(
    options.adapterDirectory ?? fileURLToPath(BUILT_IN_ADAPTERS)
  );

  validateAdapterRegistry(registry);
  validateEnabledTargets(manifest, registry);

  return { manifest, registry };
}

function validateEnabledTargets(manifest, registry) {
  const available = new Set(registry.map((adapter) => adapter.id));

  for (const [id, target] of Object.entries(manifest.targets)) {
    if (target.enabled !== false && !available.has(id)) {
      fail(`No adapter is installed for enabled target "${id}"`);
    }
  }
}

function isEnabled(manifest, adapter) {
  const target = manifest.targets[adapter.id];

  return target && target.enabled !== false;
}
