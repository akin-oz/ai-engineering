import fs from "node:fs/promises";
import path from "node:path";

const MANIFEST = `schema: 1

targets:
  claude:
    enabled: true

  codex:
    enabled: true

agents: []

rules: []
`;

const files = [
  [path.join(".ai", "templates", "codex-agents.md"), ""],
];

const directories = [
  path.join(".ai", "agents"),
  path.join(".ai", "rules"),
  path.join(".ai", "templates"),
];

export async function initializeWorkspace(root) {
  const projectRoot = path.resolve(root);
  const created = [];
  const sourceRoot = path.join(projectRoot, ".ai");

  if (!(await exists(sourceRoot))) {
    await fs.mkdir(sourceRoot, { recursive: true });
    created.push(".ai/");
  }

  const manifest = path.join(sourceRoot, "manifest.yaml");

  if (!(await exists(manifest))) {
    await fs.writeFile(manifest, MANIFEST, "utf8");
    created.push(".ai/manifest.yaml");
  }

  for (const relative of directories) {
    const directory = path.join(projectRoot, relative);

    if (await exists(directory)) {
      continue;
    }

    await fs.mkdir(directory, { recursive: true });
    created.push(`${relative}/`);
  }

  for (const [relative, contents] of files) {
    const file = path.join(projectRoot, relative);

    if (await exists(file)) {
      continue;
    }

    await fs.writeFile(file, contents, "utf8");
    created.push(relative);
  }

  return { created };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
