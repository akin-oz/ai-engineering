import fs from "node:fs/promises";
import path from "node:path";

import { exists, listMarkdown, readText } from "../filesystem.mjs";
import { splitFrontmatter } from "../render/frontmatter.mjs";

export const SOURCE_KINDS = ["agents", "rules", "commands"];

/**
 * Frontmatter on a rule is runtime-neutral metadata the compiler interprets, so
 * its vocabulary stays deliberate. Agent and command frontmatter is passed
 * through to the runtime untouched and is not validated here.
 */
const RULE_METADATA_KEYS = new Set([
  "description",
  "scope",
  // Written by `aie adopt` to record where an imported rule came from.
  "adopted-from",
  "adopted-section",
]);

const DOCUMENTED_RULE_KEYS = ["description", "scope"];

/**
 * The normalized hook vocabulary. `tools` says whether a declaration may name
 * the tools it fires for: the `-edit` events are sugar with a fixed tool set,
 * the `-tool` events exist for everything else and must name their tools.
 */
export const HOOK_EVENTS = {
  "pre-edit": { tools: "forbidden" },
  "post-edit": { tools: "forbidden" },
  "pre-tool": { tools: "required" },
  "post-tool": { tools: "required" },
  "session-start": { tools: "forbidden" },
  "session-end": { tools: "forbidden" },
  "turn-end": { tools: "forbidden" },
};

export async function loadSourceEntries(kind, names, directory, root, diagnostics) {
  const singular = kind.slice(0, -1);

  const entries = await Promise.all(names.map(async (id) => {
    const file = path.join(directory, `${id}.md`);
    const relative = path.relative(root, file);

    if (!(await exists(file))) {
      diagnostics.error("source-missing", `Unknown ${singular} "${id}"`, { file: relative });
      return undefined;
    }

    return describeSource(kind, id, await readText(file), file, relative, diagnostics);
  }));

  return entries.filter(Boolean);
}

export function describeSource(kind, id, content, file, relative, diagnostics) {
  const singular = kind.slice(0, -1);
  let split;

  try {
    split = splitFrontmatter(content);
  } catch (error) {
    diagnostics.error(
      "frontmatter-invalid",
      `The ${singular} "${id}" has invalid frontmatter: ${error.message}`,
      { file: relative }
    );

    return undefined;
  }

  const metadata = split.metadata ?? {};

  if (kind === "rules") {
    for (const key of Object.keys(metadata)) {
      if (!RULE_METADATA_KEYS.has(key)) {
        diagnostics.warning(
          "metadata-unknown-key",
          `Unknown rule metadata "${key}". Supported keys are ${DOCUMENTED_RULE_KEYS.join(", ")}.`,
          { file: relative }
        );
      }
    }
  }

  if (!split.body.trim()) {
    diagnostics.warning(
      "source-empty",
      `The ${singular} "${id}" is empty and will contribute nothing to generated output`,
      { file: relative }
    );
  }

  return { id, file, relative, content, body: split.body, metadata };
}

export async function reportUnlisted(names, directories, root, diagnostics) {
  for (const kind of SOURCE_KINDS) {
    const listed = new Set(names[kind]);

    for (const entry of await listMarkdown(directories[kind])) {
      const id = entry.slice(0, -3);

      if (listed.has(id)) {
        continue;
      }

      diagnostics.warning(
        "source-unlisted",
        `"${id}" is not listed in manifest ${kind} and will not be compiled`,
        { file: path.relative(root, path.join(directories[kind], entry)) }
      );
    }
  }
}

export async function reportUnusedHookScripts(hooks, directory, root, diagnostics) {
  const used = new Set(hooks.map((hook) => hook.name));

  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.filter((item) => item.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (used.has(entry.name)) {
      continue;
    }

    diagnostics.warning(
      "hook-script-unused",
      `"${entry.name}" is not referenced by any hook in the manifest and will not be compiled`,
      { file: path.relative(root, path.join(directory, entry.name)) }
    );
  }
}

/**
 * Hooks are configuration rather than prose, so they are declared in the
 * manifest with a normalized event vocabulary instead of being inferred from a
 * directory listing.
 */
export async function loadHooks(declared, sourceRoot, root, diagnostics, file, options = {}) {
  // Scripts a workflow pack materializes do not exist on disk yet during
  // planning, so their contents are supplied in memory instead of read.
  const provided = options.provided ?? new Map();
  const seen = options.seen ?? new Set();

  if (declared === undefined || declared === null) {
    return [];
  }

  if (!Array.isArray(declared)) {
    diagnostics.error("manifest-invalid", 'Manifest field "hooks" must be an array', { file });
    return [];
  }

  const hooks = [];

  for (const entry of declared) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      diagnostics.error("manifest-invalid", "Each hook must be a YAML object", { file });
      continue;
    }

    const { id, event, run } = entry;

    if (typeof id !== "string" || !id.trim()) {
      diagnostics.error("manifest-invalid", "Each hook must declare a non-empty id", { file });
      continue;
    }

    if (seen.has(id)) {
      diagnostics.error("manifest-invalid", `Duplicate hook id "${id}"`, { file });
      continue;
    }

    seen.add(id);

    const definition = HOOK_EVENTS[event];

    if (!definition) {
      diagnostics.error(
        "hook-unknown-event",
        `Hook "${id}" declares unknown event "${event}". Supported events are ${Object.keys(HOOK_EVENTS).join(", ")}.`,
        { file }
      );
      continue;
    }

    const tools = normalizeTools(id, event, entry.tools, definition, diagnostics, file);

    if (tools === undefined) {
      continue;
    }

    if (typeof run !== "string" || !run.trim()) {
      diagnostics.error("manifest-invalid", `Hook "${id}" must declare a script with "run"`, { file });
      continue;
    }

    const script = path.resolve(sourceRoot, run);
    const relative = path.relative(root, script);

    if (!isInside(sourceRoot, script)) {
      diagnostics.error(
        "hook-script-outside-workspace",
        `Hook "${id}" script must live inside .ai/`,
        { file }
      );
      continue;
    }

    const supplied = provided.get(script);

    if (supplied) {
      hooks.push({
        id,
        event,
        tools,
        run,
        file: script,
        relative,
        name: path.basename(script),
        content: supplied.content,
        mode: supplied.mode,
      });
      continue;
    }

    if (!(await exists(script))) {
      diagnostics.error("hook-script-missing", `Hook "${id}" script was not found`, { file: relative });
      continue;
    }

    const stats = await fs.stat(script);

    hooks.push({
      id,
      event,
      tools,
      run,
      file: script,
      relative,
      name: path.basename(script),
      content: await readText(script),
      mode: stats.mode & 0o777,
    });
  }

  return hooks;
}

/**
 * Tool names are the runtime's own vocabulary, so they are only accepted where
 * a runtime can act on them. Returns undefined when the declaration is invalid.
 */
function normalizeTools(id, event, value, definition, diagnostics, file) {
  const declared = value === undefined || value === null
    ? []
    : (Array.isArray(value) ? value : [value]);

  if (definition.tools === "forbidden") {
    if (declared.length) {
      diagnostics.error(
        "hook-tools-not-applicable",
        `Hook "${id}" declares tools, but the "${event}" event does not fire for a tool. Use "pre-tool" or "post-tool" to match specific tools.`,
        { file }
      );
      return undefined;
    }

    return [];
  }

  if (!declared.length) {
    diagnostics.error(
      "hook-tools-required",
      `Hook "${id}" uses the "${event}" event, which must declare the tools it fires for, for example: tools: [Bash]`,
      { file }
    );
    return undefined;
  }

  for (const tool of declared) {
    if (typeof tool !== "string" || !tool.trim()) {
      diagnostics.error("manifest-invalid", `Hook "${id}" tools must be non-empty strings`, { file });
      return undefined;
    }
  }

  return [...new Set(declared.map((tool) => tool.trim()))];
}

function isInside(directory, target) {
  const relative = path.relative(directory, target);

  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
