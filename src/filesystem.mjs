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

export async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

export async function writeText(file, contents) {
  await ensureDirectory(path.dirname(file));

  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(temporary, contents, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function copyDirectory(source, destination) {
  await ensureDirectory(destination);

  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourceEntry, destinationEntry);
    } else if (entry.isFile()) {
      await ensureDirectory(path.dirname(destinationEntry));
      await fs.copyFile(sourceEntry, destinationEntry);
    }
  }
}

export async function removeDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

export async function replaceDirectory(source, destination) {
  await ensureDirectory(path.dirname(destination));
  await removeDirectory(destination);
  await fs.rename(source, destination);
}
