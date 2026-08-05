import path from "node:path";

import { serializeFrontmatter } from "../render/frontmatter.mjs";

export const id = "cursor";

export const surface = {
  version: 1,
  artifacts: [{ id: "rules", kind: "directory", path: ".cursor/rules" }],
};

export const capabilities = {
  rules: "native",
  agents: "unsupported",
  commands: "unsupported",
  hooks: "unsupported",
};

const DESCRIPTION_LIMIT = 100;

export async function render(manifest) {
  const diagnostics = [];
  const directory = manifest.resolve.directory(id);

  const files = manifest.sources.rules.map((rule) => ({
    path: path.join(directory, "rules", `${rule.id}.mdc`),
    contents: serializeFrontmatter({
      description: rule.metadata.description ?? summarize(rule.body),
      globs: rule.metadata.scope,
      alwaysApply: rule.metadata.scope === undefined,
    }) + rule.body.trim() + "\n",
  }));

  for (const kind of ["agents", "commands"]) {
    for (const entry of manifest.sources[kind]) {
      diagnostics.push({
        severity: "info",
        code: "capability-unsupported",
        message: `Cursor has no repository ${kind.slice(0, -1)} format, so "${entry.id}" is not generated for this target.`,
        file: entry.relative,
      });
    }
  }

  for (const hook of manifest.sources.hooks ?? []) {
    diagnostics.push({
      severity: "info",
      code: "capability-unsupported",
      message: `Cursor has no repository hook format, so the hook "${hook.id}" is not generated for this target.`,
      file: hook.relative,
    });
  }

  return { files, diagnostics };
}

/** A rule without an explicit description gets a deterministic one. */
function summarize(body) {
  const first = body.trim().split("\n").find((line) => line.trim()) ?? "";
  const text = first.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();

  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…` : text;
}
