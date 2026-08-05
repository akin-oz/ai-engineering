import path from "node:path";

import { readTextIfExists, removeFile, writeText } from "../filesystem.mjs";

export const OWNERSHIP_VERSION = 1;

/**
 * Ownership records are compiler state, not runtime configuration. They record
 * every file a target generated so a later sync can remove its own stale output
 * without ever deleting a file the compiler did not create.
 */
export function ownershipFile(root, adapterId) {
  return path.join(root, ".ai", "state", "targets", `${adapterId}.json`);
}

export async function readOwnership(root, adapterId) {
  const contents = await readTextIfExists(ownershipFile(root, adapterId));

  if (contents === undefined) {
    return { version: OWNERSHIP_VERSION, adapter: adapterId, paths: [] };
  }

  let record;

  try {
    record = JSON.parse(contents);
  } catch {
    return { version: OWNERSHIP_VERSION, adapter: adapterId, paths: [] };
  }

  return {
    version: record.version ?? OWNERSHIP_VERSION,
    adapter: adapterId,
    paths: Array.isArray(record.paths) ? record.paths.filter((item) => typeof item === "string") : [],
    merged: isObject(record.merged) ? record.merged : {},
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The serialized record deliberately omits the tool version: a version bump
 * must not rewrite every repository's committed state and break `aie check`.
 */
export function serializeOwnership(adapterId, paths, generator, merged = {}) {
  const record = {
    version: OWNERSHIP_VERSION,
    adapter: adapterId,
    generator,
    paths: [...new Set(paths)].sort((left, right) => left.localeCompare(right)),
  };

  // Entries the compiler owns inside a file it shares with the user, recorded
  // verbatim so a later sync can tell its own writes from hand edits.
  if (Object.keys(merged).length) {
    record.merged = merged;
  }

  return `${JSON.stringify(record, null, 2)}\n`;
}

export async function writeOwnership(root, adapterId, paths, generator, merged) {
  await writeText(
    ownershipFile(root, adapterId),
    serializeOwnership(adapterId, paths, generator, merged)
  );
}

export async function removeOwnership(root, adapterId) {
  await removeFile(ownershipFile(root, adapterId));
}

export function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export function fromPosix(relativePath) {
  return relativePath.split("/").join(path.sep);
}
