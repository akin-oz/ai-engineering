import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parse } from "yaml";

import { createDiagnostics, fail } from "../diagnostics.mjs";
import {
  SOURCE_KINDS,
  loadHooks,
  loadSourceEntries,
  reportUnlisted,
  reportUnusedHookScripts,
} from "./sources.mjs";
import { createFileMap, finalizeManifest, normalizeTargets } from "./normalize.mjs";

const MANIFEST_VERSION = 1;

export const MANIFEST_FILE = path.join(".ai", "manifest.yaml");

export async function loadManifest(root = process.cwd(), options = {}) {
  const diagnostics = options.diagnostics ?? createDiagnostics();
  const projectRoot = path.resolve(root);
  const sourceRoot = path.join(projectRoot, ".ai");
  const file = path.join(sourceRoot, "manifest.yaml");
  let source;

  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    fail(`No AI workspace found.

Run:

    aie init

to initialize this repository.`);
  }

  let raw;

  try {
    raw = parse(source);
  } catch (error) {
    fail(`Manifest YAML is invalid: ${error.message}`, {
      file: path.relative(projectRoot, file),
    });
  }

  const relativeManifest = path.relative(projectRoot, file);
  const version = validateManifest(raw, relativeManifest);
  const targets = normalizeTargets(raw.targets ?? {}, projectRoot);
  const files = createFileMap(projectRoot, sourceRoot, targets);

  const names = Object.fromEntries(
    SOURCE_KINDS.map((kind) => [kind, normalizeNames(raw[kind], kind, relativeManifest)])
  );

  const sources = Object.fromEntries(
    await Promise.all(
      SOURCE_KINDS.map(async (kind) => [
        kind,
        await loadSourceEntries(kind, names[kind], files[kind], projectRoot, diagnostics),
      ])
    )
  );

  sources.hooks = await loadHooks(raw.hooks, sourceRoot, projectRoot, diagnostics, relativeManifest);

  await reportUnlisted(names, files, projectRoot, diagnostics);
  await reportUnusedHookScripts(sources.hooks, files.hooks, projectRoot, diagnostics);

  diagnostics.throwIfFailed();

  return finalizeManifest({
    version,
    root: projectRoot,
    sourceRoot,
    targets,
    names,
    sources,
    files,
  });
}

function validateManifest(value, file) {
  if (!isObject(value)) {
    fail("Manifest must contain a YAML object", { file });
  }

  const version = value.version ?? value.schema;

  if (version !== MANIFEST_VERSION) {
    fail(`Unsupported manifest version: ${version}`, { file });
  }

  if (value.targets !== undefined && !isObject(value.targets)) {
    fail("Manifest targets must contain a YAML object", { file });
  }

  for (const [id, target] of Object.entries(value.targets ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      fail(`Target id "${id}" must contain lowercase letters, numbers, and hyphens`, { file });
    }

    if (!isObject(target)) {
      fail(`Target "${id}" must contain a YAML object`, { file });
    }

    if (target.enabled !== undefined && typeof target.enabled !== "boolean") {
      fail(`Target "${id}" enabled must be a boolean`, { file });
    }

    if (target.output !== undefined && typeof target.output !== "string") {
      fail(`Target "${id}" output must be a string`, { file });
    }
  }

  return version;
}

function normalizeNames(value = [], field, file) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    fail(`Manifest field "${field}" must be an array`, { file });
  }

  const names = [];
  const seen = new Set();

  for (const name of value) {
    if (typeof name !== "string" || !name.trim()) {
      fail(`Manifest field "${field}" must contain non-empty strings`, { file });
    }

    const normalized = name.trim();

    if (!seen.has(normalized)) {
      seen.add(normalized);
      names.push(normalized);
    }
  }

  return names;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
