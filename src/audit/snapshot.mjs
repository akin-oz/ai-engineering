import fs from "node:fs/promises";
import path from "node:path";

import { DiagnosticError } from "../diagnostics.mjs";
import { readTextIfExists } from "../filesystem.mjs";

export const SETTINGS = ".claude/settings.json";

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
const WORKFLOWS = path.join(".github", "workflows");

/**
 * Everything the audit rules look at, collected once so the rules themselves
 * stay pure. File contents are read only for configuration the rules inspect —
 * settings, the hook scripts settings run, CI workflows. Every other file is
 * known by name alone, so a secret's contents are never opened.
 */
export async function collectSnapshot(root) {
  const settingsText = await readTextIfExists(path.join(root, SETTINGS));
  let settings;

  if (settingsText !== undefined) {
    try {
      settings = JSON.parse(settingsText);
    } catch (error) {
      throw new DiagnosticError(`${SETTINGS} is not valid JSON (${error.message}), so it cannot be audited.`, [{
        severity: "error",
        code: "settings-unparseable",
        message: `${SETTINGS} is not valid JSON.`,
        file: SETTINGS,
      }]);
    }
  }

  return {
    settings: isObject(settings) ? settings : undefined,
    files: await listFiles(root, root),
    gitHooks: await listGitHooks(root),
    hookScripts: await readHookScripts(root, settings),
    workflows: await readWorkflows(root),
  };
}

async function listFiles(directory, root) {
  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const location = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...await listFiles(location, root));
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(toPosix(path.relative(root, location)));
    }
  }

  return files;
}

async function listGitHooks(root) {
  try {
    const entries = await fs.readdir(path.join(root, ".git", "hooks"), { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith(".sample"))
      .map((entry) => `.git/hooks/${entry.name}`)
      .sort();
  } catch {
    return [];
  }
}

/** Hook commands that point at a script inside the repository, with its text. */
async function readHookScripts(root, settings) {
  const scripts = new Map();
  const events = isObject(settings?.hooks) ? Object.values(settings.hooks) : [];

  for (const entry of events.flat()) {
    for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : []) {
      const relative = scriptPath(hook?.command);

      if (!relative || scripts.has(relative)) {
        continue;
      }

      const absolute = path.resolve(root, relative);

      if (path.relative(root, absolute).startsWith("..")) {
        continue;
      }

      const contents = await readTextIfExists(absolute).catch(() => undefined);

      if (contents !== undefined) {
        scripts.set(toPosix(path.relative(root, absolute)), contents);
      }
    }
  }

  return [...scripts].map(([file, contents]) => ({ file, contents }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

function scriptPath(command) {
  if (typeof command !== "string") {
    return undefined;
  }

  const first = command.trim().match(/^(?:"[^"]*"|'[^']*'|[^\s"'])+/)?.[0] ?? "";
  const unquoted = first.replace(/["']/g, "");
  const relative = unquoted.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\/?/, "");

  return relative && !relative.startsWith("$") && !path.isAbsolute(relative) ? relative : undefined;
}

async function readWorkflows(root) {
  let names;

  try {
    names = await fs.readdir(path.join(root, WORKFLOWS));
  } catch {
    return [];
  }

  const workflows = [];

  for (const name of names.filter((item) => /\.ya?ml$/.test(item)).sort()) {
    const contents = await readTextIfExists(path.join(root, WORKFLOWS, name)).catch(() => undefined);

    if (contents !== undefined) {
      workflows.push({ file: `.github/workflows/${name}`, contents });
    }
  }

  return workflows;
}

function toPosix(relative) {
  return relative.split(path.sep).join("/");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
