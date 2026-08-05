import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const bin = path.join(projectRoot, "bin", "aie.mjs");

export async function makeWorkspace({
  manifest = "version: 1\ntargets: {}\n",
  agents = {},
  rules = {},
  commands = {},
  templates = {},
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-engineering-test-"));
  const ai = path.join(root, ".ai");

  await fs.mkdir(ai, { recursive: true });
  await fs.writeFile(path.join(ai, "manifest.yaml"), manifest);

  for (const [directory, files] of Object.entries({ agents, rules, commands, templates })) {
    const location = path.join(ai, directory);
    await fs.mkdir(location, { recursive: true });

    for (const [name, contents] of Object.entries(files)) {
      await fs.writeFile(path.join(location, name), contents);
    }
  }

  return {
    root,
    ai,
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * A temporary repository driven through the real CLI binary, so tests exercise
 * the same path a user does: argument parsing, exit codes, and stdout included.
 */
export async function makeRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-engineering-repo-"));

  return {
    root,
    run(...args) {
      const result = spawnSync(process.execPath, [bin, ...args], {
        cwd: root,
        encoding: "utf8",
      });

      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    async write(relative, contents) {
      const file = path.join(root, relative);

      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents, "utf8");
    },
    async read(relative) {
      return fs.readFile(path.join(root, relative), "utf8");
    },
    async exists(relative) {
      return fileExists(path.join(root, relative));
    },
    async tree() {
      return listFiles(root, root);
    },
    async fingerprint() {
      const files = await listFiles(root, root);
      const hash = crypto.createHash("sha256");

      for (const relative of files) {
        hash.update(relative);
        hash.update(await fs.readFile(path.join(root, relative)));
      }

      return hash.digest("hex");
    },
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** Initializes a repository and syncs it, asserting both steps succeed. */
export async function initializedRepository() {
  const repository = await makeRepository();
  const init = repository.run("init");

  assert.equal(init.code, 0, init.stderr);

  return repository;
}

async function listFiles(directory, root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const location = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(location, root));
    } else if (entry.isFile()) {
      files.push(path.relative(root, location).split(path.sep).join("/"));
    }
  }

  return files;
}

export async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
