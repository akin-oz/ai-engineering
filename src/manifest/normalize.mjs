import path from "node:path";

import { fail } from "../diagnostics.mjs";

export function normalizeTargets(targets, root) {
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

export function createFileMap(root, sourceRoot, targets) {
  return {
    root,
    sourceRoot,
    agents: path.join(sourceRoot, "agents"),
    rules: path.join(sourceRoot, "rules"),
    commands: path.join(sourceRoot, "commands"),
    hooks: path.join(sourceRoot, "hooks"),
    templates: path.join(sourceRoot, "templates"),
    generated: path.join(sourceRoot, "generated"),
    state: path.join(sourceRoot, "state"),
    outputs: Object.fromEntries(
      Object.entries(targets).map(([id, target]) => [id, target.output])
    ),
  };
}

/** Builds the immutable manifest every adapter receives, whatever produced it. */
export function finalizeManifest({
  version,
  root,
  sourceRoot,
  targets,
  names,
  sources,
  files,
  generated = [],
  workflow,
}) {
  return deepFreeze({
    version,
    root,
    sourceRoot,
    targets,
    agents: names.agents,
    rules: names.rules,
    commands: names.commands,
    sources,
    files,
    generated,
    workflow,
    resolve: {
      agent: (name) => path.join(files.agents, `${name}.md`),
      rule: (name) => path.join(files.rules, `${name}.md`),
      command: (name) => path.join(files.commands, `${name}.md`),
      output: (id) => files.outputs[id],
      directory: (id) => path.relative(root, files.outputs[id] ?? path.join(root, `.${id}`)),
    },
  });
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
