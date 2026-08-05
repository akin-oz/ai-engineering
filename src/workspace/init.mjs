import fs from "node:fs/promises";
import path from "node:path";

const MANIFEST = `version: 1

targets:
  claude:
    enabled: true

  codex:
    enabled: true

agents: []

rules:
  - project

commands: []
`;

const PROJECT_RULE = `Describe how an AI assistant should work in this repository.
Replace this text with your first real rule — for example:

Prefer small, reviewable changes. Explain trade-offs when several
reasonable approaches exist. Never edit generated files by hand.
`;

const CLAUDE_TEMPLATE = `<!-- aie:note {{RULES}} is replaced with every rule listed in .ai/manifest.yaml. -->
# Project instructions

{{RULES}}
`;

const AGENTS_TEMPLATE = `<!-- aie:note {{RULES}} and {{AGENTS}} are replaced with the rules and agents listed in .ai/manifest.yaml. -->
# Project instructions

{{RULES}}

---

{{AGENTS}}
`;

const BLUEPRINT = `schema: 2

project:
  type: library

workflow:
  development: spec-driven

ai:
  runtimes: [claude, codex]
`;

const directories = [
  path.join(".ai", "agents"),
  path.join(".ai", "rules"),
  path.join(".ai", "commands"),
  path.join(".ai", "templates"),
];

const files = [
  [path.join(".ai", "rules", "project.md"), PROJECT_RULE],
  [path.join(".ai", "templates", "claude.md"), CLAUDE_TEMPLATE],
  [path.join(".ai", "templates", "agents.md"), AGENTS_TEMPLATE],
];

const RUNTIME_FILES = ["CLAUDE.md", "AGENTS.md"];

export async function initializeWorkspace(root, options = {}) {
  const projectRoot = path.resolve(root);
  const created = [];
  const sourceRoot = path.join(projectRoot, ".ai");

  if (!(await exists(sourceRoot))) {
    await fs.mkdir(sourceRoot, { recursive: true });
    created.push(".ai/");
  }

  const entry = options.blueprint
    ? { file: "blueprint.yaml", contents: BLUEPRINT }
    : { file: "manifest.yaml", contents: MANIFEST };
  const workspaceFile = path.join(sourceRoot, entry.file);
  const other = path.join(sourceRoot, options.blueprint ? "manifest.yaml" : "blueprint.yaml");

  if (await exists(other)) {
    throw new Error(
      `This workspace already uses .ai/${path.basename(other)}. ` +
      "A workspace is described by a blueprint or a manifest, not both."
    );
  }

  if (!(await exists(workspaceFile))) {
    await fs.writeFile(workspaceFile, entry.contents, "utf8");
    created.push(`.ai/${entry.file}`);
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

  return { created, existingRuntimeFiles: await findRuntimeFiles(projectRoot) };
}

async function findRuntimeFiles(projectRoot) {
  const found = [];

  for (const name of RUNTIME_FILES) {
    if (await exists(path.join(projectRoot, name))) {
      found.push(name);
    }
  }

  return found;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
