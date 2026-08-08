import path from "node:path";

import {
  applyTemplate,
  banner,
  normalizeDocument,
  renderSections,
} from "../render/document.mjs";
import { resolveTemplate } from "../render/template.mjs";
import { NAME } from "../version.mjs";

export const id = "claude";

const SETTINGS = ".claude/settings.json";

export const surface = {
  version: 1,
  artifacts: [
    { id: "root-instructions", kind: "file", path: "CLAUDE.md" },
    { id: "agents", kind: "directory", path: ".claude/agents" },
    { id: "commands", kind: "directory", path: ".claude/commands" },
    { id: "hook-scripts", kind: "directory", path: ".claude/hooks" },
    { id: "settings", kind: "file", path: SETTINGS, merge: true },
  ],
};

export const capabilities = {
  rules: "inline",
  agents: "native",
  commands: "native",
  hooks: "settings-merge",
};

const EDIT_TOOLS = "Edit|Write|NotebookEdit";

/** Normalized events mapped to the Claude Code events that can express them. */
const HOOK_EVENTS = {
  "pre-edit": { event: "PreToolUse", matcher: EDIT_TOOLS },
  "post-edit": { event: "PostToolUse", matcher: EDIT_TOOLS },
  "pre-tool": { event: "PreToolUse" },
  "post-tool": { event: "PostToolUse" },
  "session-start": { event: "SessionStart" },
  "session-end": { event: "SessionEnd" },
  "turn-end": { event: "Stop" },
};

export async function render(manifest, context = {}) {
  const diagnostics = [];
  const directory = manifest.resolve.directory(id);
  const files = [];

  const template = await resolveTemplate(manifest, {
    name: "claude",
    required: manifest.rules.length ? ["RULES"] : [],
    diagnostics,
  });

  files.push({
    path: "CLAUDE.md",
    contents: banner(id, NAME) + normalizeDocument(applyTemplate(template.content, {
      RULES: renderSections(manifest.sources.rules, "Rule"),
      AGENTS: renderSections(manifest.sources.agents, "Agent"),
    })),
  });

  for (const agent of manifest.sources.agents) {
    files.push({ path: path.join(directory, "agents", `${agent.id}.md`), contents: agent.content });
  }

  for (const command of manifest.sources.commands) {
    files.push({ path: path.join(directory, "commands", `${command.id}.md`), contents: command.content });
  }

  const hooks = manifest.sources.hooks ?? [];

  for (const hook of hooks) {
    files.push({
      path: path.join(directory, "hooks", hook.name),
      contents: hook.content,
      mode: hook.mode | 0o100,
    });
  }

  const settings = mergeSettings(hooks, directory, context, diagnostics);

  if (settings) {
    files.push(settings);
  }

  return { files, remove: legacyRuleFiles(manifest, directory), diagnostics };
}

/**
 * `settings.json` belongs to the user. The compiler owns individual hook
 * entries inside it, recorded verbatim in the ownership record so a later sync
 * can tell its own writes from hand edits. Everything else is preserved.
 */
function mergeSettings(hooks, directory, context, diagnostics) {
  const previous = context.owned?.merged?.[SETTINGS] ?? {};
  const existingText = context.existing?.[SETTINGS];

  if (!hooks.length && !Object.keys(previous).length) {
    return undefined;
  }

  let settings = {};

  if (existingText !== undefined) {
    try {
      settings = JSON.parse(existingText);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "settings-unparseable",
        message: `${SETTINGS} is not valid JSON (${error.message}), so hooks cannot be merged into it.`,
        file: SETTINGS,
      });

      return undefined;
    }
  }

  const planned = {};

  for (const hook of hooks) {
    const mapping = HOOK_EVENTS[hook.event];
    const matcher = mapping.matcher ?? (hook.tools?.length ? hook.tools.join("|") : undefined);
    const entry = {
      ...(matcher ? { matcher } : {}),
      hooks: [{
        type: "command",
        command: `"$CLAUDE_PROJECT_DIR"/${path.join(directory, "hooks", hook.name)}`,
      }],
    };

    (planned[mapping.event] ??= []).push(entry);
  }

  const merged = { ...settings, hooks: { ...(settings.hooks ?? {}) } };

  for (const event of new Set([...Object.keys(previous), ...Object.keys(planned)])) {
    const current = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const owned = previous[event] ?? [];
    const ownedCommands = new Set(owned.flatMap(commandsOf));

    const kept = current.filter((entry) => {
      if (owned.some((item) => equal(item, entry))) {
        return false;
      }

      // Same script, different content: the user edited an entry we generated.
      if (commandsOf(entry).some((command) => ownedCommands.has(command))) {
        diagnostics.push({
          severity: "error",
          code: "settings-entry-modified",
          message: `A generated hook entry in ${SETTINGS} was modified by hand. Restore it or remove it, then run sync again.`,
          file: SETTINGS,
        });
      }

      return true;
    });

    const next = [...kept, ...(planned[event] ?? [])];

    if (next.length) {
      merged.hooks[event] = next;
    } else {
      delete merged.hooks[event];
    }
  }

  if (!Object.keys(merged.hooks).length) {
    delete merged.hooks;
  }

  return {
    path: SETTINGS,
    kind: "merge",
    owns: planned,
    contents: `${JSON.stringify(merged, null, 2)}\n`,
  };
}

function commandsOf(entry) {
  return (entry?.hooks ?? []).map((item) => item?.command).filter(Boolean);
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Releases before 0.2 copied rules into `.claude/rules/`. Rules are now inlined
 * into CLAUDE.md, so those copies are stale. They carry no banner, so authorship
 * is proven by content equality with the source rule instead.
 */
function legacyRuleFiles(manifest, directory) {
  return manifest.sources.rules.map((rule) => ({
    path: path.join(directory, "rules", `${rule.id}.md`),
    proof: { kind: "equals", contents: rule.content },
  }));
}
