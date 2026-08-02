import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  copyDirectory,
  ensureDirectory,
  exists,
  removeDirectory,
  replaceDirectory,
} from "../filesystem.mjs";

export const id = "claude";

const mappings = [
  ["agents", "agents"],
  ["rules", "rules"],
  ["hooks", "hooks"],
  ["commands", "commands"],
];

export async function render(manifest) {
  const output = manifest.resolve.output(id);
  const staging = `${output}.${randomUUID()}.tmp`;
  let files = 0;

  try {
    await ensureDirectory(staging);

    for (const [sourceName, targetName] of mappings) {
      const source = manifest.files[sourceName];

      if (!(await exists(source))) {
        continue;
      }

      await copyDirectory(source, path.join(staging, targetName));
      files += 1;
    }

    await replaceDirectory(staging, output);
  } finally {
    await removeDirectory(staging);
  }

  return { files };
}
