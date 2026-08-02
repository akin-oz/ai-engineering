import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function makeWorkspace({
  manifest = "version: 1\ntargets: {}\n",
  agents = {},
  rules = {},
  templates = {},
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-engineering-test-"));
  const ai = path.join(root, ".ai");

  await fs.mkdir(ai, { recursive: true });
  await fs.writeFile(path.join(ai, "manifest.yaml"), manifest);

  for (const [directory, files] of Object.entries({ agents, rules, templates })) {
    const location = path.join(ai, directory);
    await fs.mkdir(location, { recursive: true });

    for (const [name, contents] of Object.entries(files)) {
      await fs.writeFile(path.join(location, name), contents);
    }
  }

  for (const directory of ["hooks", "commands"]) {
    await fs.mkdir(path.join(ai, directory), { recursive: true });
  }

  return {
    root,
    ai,
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
