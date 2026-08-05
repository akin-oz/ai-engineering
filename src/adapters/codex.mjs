import path from "node:path";

import {
  applyTemplate,
  banner,
  normalizeDocument,
  renderSections,
} from "../render/document.mjs";
import { resolveTemplate } from "../render/template.mjs";
import { NAME } from "../version.mjs";

export const id = "codex";

export const surface = {
  version: 1,
  artifacts: [{ id: "root-instructions", kind: "file", path: "AGENTS.md" }],
};

export const capabilities = {
  rules: "inline",
  agents: "inline",
  commands: "unsupported",
  hooks: "unsupported",
};

export async function render(manifest) {
  const diagnostics = [];

  const template = await resolveTemplate(manifest, {
    name: "agents",
    legacyName: "codex-agents",
    required: [
      ...(manifest.rules.length ? ["RULES"] : []),
      ...(manifest.agents.length ? ["AGENTS"] : []),
    ],
    diagnostics,
  });

  const document = normalizeDocument(applyTemplate(template.content, {
    RULES: renderSections(manifest.sources.rules, "Rule"),
    AGENTS: renderSections(manifest.sources.agents, "Agent"),
  }));

  for (const command of manifest.sources.commands) {
    diagnostics.push({
      severity: "info",
      code: "capability-unsupported",
      message: `Codex has no repository command format, so the command "${command.id}" is not generated for this target.`,
      file: command.relative,
    });
  }

  for (const hook of manifest.sources.hooks ?? []) {
    diagnostics.push({
      severity: "info",
      code: "capability-unsupported",
      message: `Codex has no repository hook format, so the hook "${hook.id}" is not generated for this target.`,
      file: hook.relative,
    });
  }

  return {
    files: [{ path: "AGENTS.md", contents: banner(id, NAME) + document }],
    remove: [
      {
        path: path.join(manifest.resolve.directory(id), "AGENTS.md"),
        proof: { kind: "banner" },
      },
    ],
    diagnostics,
  };
}
