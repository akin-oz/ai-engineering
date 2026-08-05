import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readText(file) {
  return fs.readFile(file, "utf8");
}

export async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

export async function writeText(file, contents, mode) {
  await ensureDirectory(path.dirname(file));

  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(temporary, contents, "utf8");

    if (mode !== undefined) {
      await fs.chmod(temporary, mode);
    }

    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function fileMode(file) {
  try {
    return (await fs.stat(file)).mode & 0o777;
  } catch {
    return undefined;
  }
}

export async function removeFile(file) {
  await fs.rm(file, { force: true });
}

export async function removeDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

export async function listMarkdown(directory) {
  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Removes empty ancestor directories of `file`, stopping at `root`. A directory
 * that still contains anything is never removed, so unrelated user files always
 * keep their parent directories.
 */
export async function pruneEmptyDirectories(file, root) {
  let directory = path.dirname(path.resolve(file));
  const stop = path.resolve(root);

  while (directory !== stop && directory.startsWith(stop + path.sep)) {
    let remaining;

    try {
      remaining = await fs.readdir(directory);
    } catch {
      return;
    }

    if (remaining.length) {
      return;
    }

    try {
      await fs.rmdir(directory);
    } catch {
      return;
    }

    directory = path.dirname(directory);
  }
}
