import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parse } from "yaml";

import { fail } from "../diagnostics.mjs";

const MANIFEST_VERSION = 1;

export async function loadManifest(root = process.cwd()) {
  const projectRoot = path.resolve(root);
  const sourceRoot = path.join(projectRoot, ".ai");
  const file = path.join(sourceRoot, "manifest.yaml");
  let source;

  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    fail("Manifest not found", { file: path.relative(projectRoot, file) });
  }

  let raw;

  try {
    raw = parse(source);
  } catch (error) {
    fail(`Manifest YAML is invalid: ${error.message}`, {
      file: path.relative(projectRoot, file),
    });
  }

  validateManifest(raw, file);

  const targets = normalizeTargets(raw.targets ?? {}, projectRoot);
  const files = createFileMap(projectRoot, sourceRoot, targets);
  const agents = normalizeNames(raw.agents, "agents", file);
  const rules = normalizeNames(raw.rules, "rules", file);

  await validateSourceEntries(files.agents, agents, "agent", projectRoot);
  await validateSourceEntries(files.rules, rules, "rule", projectRoot);

  return deepFreeze({
    version: raw.version,
    root: projectRoot,
    sourceRoot,
    targets,
    agents,
    rules,
    files,
    resolve: {
      agent: (name) => path.join(files.agents, `${name}.md`),
      rule: (name) => path.join(files.rules, `${name}.md`),
      output: (id) => files.outputs[id],
    },
  });
}

function validateManifest(value, file) {
  if (!isObject(value)) {
    fail("Manifest must contain a YAML object", { file });
  }

  if (value.version !== MANIFEST_VERSION) {
    fail(`Unsupported manifest version: ${value.version}`, { file });
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
}

function normalizeTargets(targets, root) {
  return Object.fromEntries(Object.entries(targets).map(([id, target]) => {
    const configuredOutput = target.output ?? `.${id}`;

    if (path.isAbsolute(configuredOutput)) {
      fail(`Target "${id}" output must be a relative path`);
    }

    const output = path.resolve(root, configuredOutput);
    const relative = path.relative(root, output);
    const sourceRelative = path.relative(root, path.join(root, ".ai"));

    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative === sourceRelative ||
      relative.startsWith(`${sourceRelative}${path.sep}`)
    ) {
      fail(`Target "${id}" output must stay inside the project root`);
    }

    return [id, { ...target, output }];
  }));
}

function createFileMap(root, sourceRoot, targets) {
  return {
    root,
    sourceRoot,
    agents: path.join(sourceRoot, "agents"),
    rules: path.join(sourceRoot, "rules"),
    hooks: path.join(sourceRoot, "hooks"),
    commands: path.join(sourceRoot, "commands"),
    templates: path.join(sourceRoot, "templates"),
    outputs: Object.fromEntries(
      Object.entries(targets).map(([id, target]) => [id, target.output])
    ),
  };
}

function normalizeNames(value = [], field, file) {
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

async function validateSourceEntries(directory, names, type, root) {
  await Promise.all(names.map(async (name) => {
    const file = path.join(directory, `${name}.md`);

    if (!(await exists(file))) {
      fail(`Unknown ${type} "${name}"`, {
        file: path.relative(root, file),
      });
    }
  }));
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return value;
}
