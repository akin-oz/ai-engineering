import path from "node:path";
import process from "node:process";

import { createDiagnostics, fail } from "../diagnostics.mjs";
import { exists } from "../filesystem.mjs";
import { loadBlueprint } from "./blueprint.mjs";
import { loadManifest } from "./load.mjs";

/**
 * A workspace is described either by a hand-authored schema 1 manifest or by a
 * schema 2 blueprint that composes a workflow pack. Both produce the same
 * normalized manifest, so adapters never learn which one was used.
 */
export async function loadWorkspace(root = process.cwd(), options = {}) {
  const diagnostics = options.diagnostics ?? createDiagnostics();
  const projectRoot = path.resolve(root);
  const sourceRoot = path.join(projectRoot, ".ai");

  const hasBlueprint = await exists(path.join(sourceRoot, "blueprint.yaml"));
  const hasManifest = await exists(path.join(sourceRoot, "manifest.yaml"));

  if (hasBlueprint && hasManifest) {
    fail(
      "This workspace has both .ai/blueprint.yaml and .ai/manifest.yaml. " +
      "Keep one: the blueprint composes a workflow, the manifest lists sources by hand."
    );
  }

  if (hasBlueprint) {
    return loadBlueprint(projectRoot, { diagnostics });
  }

  return loadManifest(projectRoot, { diagnostics });
}
