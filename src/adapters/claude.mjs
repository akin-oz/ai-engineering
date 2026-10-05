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
  permissions: "settings-merge",
  sandbox: "settings-merge",
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

/**
 * Sandbox keys Claude Code documents (code.claude.com/docs/en/sandboxing and the
 * settings reference). An unknown key is a warning, not an error: the runtime
 * adds keys faster than this compiler releases, but a typo must not pass
 * silently as a setting that does nothing.
 */
const SANDBOX_KEYS = {
  enabled: true,
  failIfUnavailable: true,
  allowUnsandboxedCommands: true,
  autoAllowBashIfSandboxed: true,
  excludedCommands: true,
  ignoreViolations: true,
  allowAppleEvents: true,
  enableWeakerNestedSandbox: true,
  enableWeakerNetworkIsolation: true,
  bwrapPath: true,
  socatPath: true,
  ripgrep: true,
  filesystem: {
    allowRead: true,
    allowWrite: true,
    denyRead: true,
    denyWrite: true,
    disabled: true,
    allowManagedReadPathsOnly: true,
  },
  network: {
    allowedDomains: true,
    deniedDomains: true,
    allowUnixSockets: true,
    allowAllUnixSockets: true,
    allowLocalBinding: true,
    allowMachLookup: true,
    strictAllowlist: true,
    allowManagedDomainsOnly: true,
    tlsTerminate: true,
    httpProxyPort: true,
    socksProxyPort: true,
  },
  credentials: {
    envVars: true,
    files: true,
    awsPairs: true,
    sigv4: true,
    allowPlaintextInject: true,
  },
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

  reportUnknownSandboxKeys(manifest.sandbox ?? {}, SANDBOX_KEYS, "sandbox", diagnostics);

  const settings = mergeSettings(manifest, hooks, directory, context, diagnostics);

  if (settings) {
    files.push(settings);
  }

  return { files, remove: legacyRuleFiles(manifest, directory), diagnostics };
}

/**
 * `settings.json` belongs to the user. The compiler owns individual entries
 * inside it — hook entries, permission rules, sandbox values — recorded
 * verbatim in the ownership record so a later sync can tell its own writes from
 * hand edits. Everything else is preserved, and nothing the file already held
 * is ever claimed.
 */
function mergeSettings(manifest, hooks, directory, context, diagnostics) {
  const { permissions: ownedPermissions = {}, sandbox: ownedSandbox = {}, ...ownedHooks } =
    context.owned?.merged?.[SETTINGS] ?? {};
  const permissions = Object.fromEntries(
    ["allow", "deny"]
      .filter((key) => manifest.permissions?.[key]?.length)
      .map((key) => [key, manifest.permissions[key]])
  );
  const sandbox = manifest.sandbox ?? {};
  const existingText = context.existing?.[SETTINGS];

  const declares = hooks.length || Object.keys(permissions).length || Object.keys(sandbox).length;
  const owned = Object.keys(ownedHooks).length || Object.keys(ownedPermissions).length ||
    Object.keys(ownedSandbox).length;

  if (!declares && !owned) {
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
        message: `${SETTINGS} is not valid JSON (${error.message}), so settings cannot be merged into it.`,
        file: SETTINGS,
      });

      return undefined;
    }
  }

  const planned = plannedHooks(hooks, directory);
  const merged = { ...settings };
  const hookEntries = mergeHooks(merged.hooks, planned, ownedHooks, diagnostics);

  if (hookEntries === undefined) {
    delete merged.hooks;
  } else {
    merged.hooks = hookEntries;
  }

  const owns = { ...planned };

  for (const [key, plan, previous] of [
    ["permissions", permissions, ownedPermissions],
    ["sandbox", sandbox, ownedSandbox],
  ]) {
    const result = mergeObject(merged[key], plan, previous, key, diagnostics);

    if (result.remove) {
      delete merged[key];
    } else {
      merged[key] = result.value;
    }

    if (result.owns) {
      owns[key] = result.owns;
    }
  }

  return {
    path: SETTINGS,
    kind: "merge",
    owns,
    contents: `${JSON.stringify(merged, null, 2)}\n`,
  };
}

function plannedHooks(hooks, directory) {
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

  return planned;
}

function mergeHooks(existing, planned, previous, diagnostics) {
  const merged = { ...(existing ?? {}) };

  for (const event of new Set([...Object.keys(previous), ...Object.keys(planned)])) {
    const current = Array.isArray(merged[event]) ? merged[event] : [];
    const owned = previous[event] ?? [];
    const ownedCommands = new Set(owned.flatMap(commandsOf));

    const kept = current.filter((entry) => {
      if (owned.some((item) => equal(item, entry))) {
        return false;
      }

      // Same script, different content: the user edited an entry we generated.
      if (commandsOf(entry).some((command) => ownedCommands.has(command))) {
        modified(diagnostics, "A generated hook entry");
      }

      return true;
    });

    const next = [...kept, ...(planned[event] ?? [])];

    if (next.length) {
      merged[event] = next;
    } else {
      delete merged[event];
    }
  }

  return Object.keys(merged).length ? merged : undefined;
}

/**
 * Merges a planned mapping into the user's, key by key. Returns the merged
 * value, whether the key should be removed, and exactly what the compiler owns
 * afterwards. A container is only removed when this merge emptied it or would
 * otherwise have created it empty — never an empty object the user wrote.
 */
function mergeObject(current, planned, owned, at, diagnostics) {
  if (current !== undefined && !isObject(current)) {
    conflict(diagnostics, at, "is not a mapping");
    return { value: current };
  }

  const value = { ...(current ?? {}) };
  const owns = {};
  let removed = false;

  for (const key of new Set([...Object.keys(planned), ...Object.keys(owned)])) {
    const here = `${at}.${key}`;
    const plan = planned[key];
    const previous = owned[key];
    let result;

    if (Array.isArray(plan) || Array.isArray(previous)) {
      result = mergeArray(value[key], plan ?? [], previous ?? [], here, diagnostics);
    } else if (isObject(plan) || isObject(previous)) {
      result = mergeObject(value[key], isObject(plan) ? plan : {}, isObject(previous) ? previous : {}, here, diagnostics);
    } else {
      result = mergeScalar(value[key], plan, previous, key in planned, key in owned, here, diagnostics);
    }

    if (result.remove) {
      removed ||= key in value;
      delete value[key];
    } else {
      value[key] = result.value;
    }

    if (result.owns !== undefined) {
      owns[key] = result.owns;
    }
  }

  return {
    value,
    remove: !Object.keys(value).length && (current === undefined || removed),
    owns: Object.keys(owns).length ? owns : undefined,
  };
}

function mergeArray(current, planned, owned, at, diagnostics) {
  if (current !== undefined && !Array.isArray(current)) {
    conflict(diagnostics, at, "is not a list");
    return { value: current };
  }

  const entries = current ?? [];
  const present = new Set(entries.map(key));
  const plannedKeys = new Set(planned.map(key));
  const ownedKeys = new Set(owned.map(key));

  for (const entry of owned) {
    if (plannedKeys.has(key(entry)) && !present.has(key(entry))) {
      modified(diagnostics, `The generated entry ${JSON.stringify(entry)} in ${at}`);
    }
  }

  const kept = entries.filter((entry) => !ownedKeys.has(key(entry)));
  const keptKeys = new Set(kept.map(key));
  // An entry the user already has stays theirs: never claimed, never removed.
  const owns = planned.filter((entry) => !keptKeys.has(key(entry)));
  const value = [...kept, ...owns];

  return {
    value,
    remove: !value.length && (current === undefined || kept.length < entries.length),
    owns: owns.length ? owns : undefined,
  };
}

function mergeScalar(current, planned, owned, isPlanned, isOwned, at, diagnostics) {
  if (isOwned) {
    if (current === undefined && !isPlanned) {
      return { remove: true };
    }

    if (!equal(current, owned)) {
      modified(diagnostics, `The generated value of ${at}`);
      return { value: current, remove: current === undefined };
    }

    return isPlanned ? { value: planned, owns: planned } : { remove: true };
  }

  if (current === undefined) {
    return isPlanned ? { value: planned, owns: planned } : { remove: true };
  }

  if (isPlanned && !equal(current, planned)) {
    diagnostics.push({
      severity: "warning",
      code: "settings-value-conflict",
      message: `${at} is ${JSON.stringify(current)} in ${SETTINGS}, which the compiler did not write, so the declared ${JSON.stringify(planned)} is not applied. Remove it from ${SETTINGS} to let the workspace set it.`,
      file: SETTINGS,
      key: at,
    });
  }

  return { value: current };
}

function modified(diagnostics, subject) {
  diagnostics.push({
    severity: "error",
    code: "settings-entry-modified",
    message: `${subject} was modified by hand in ${SETTINGS}. Restore it or remove it from .ai/, then run sync again.`,
    file: SETTINGS,
  });
}

function conflict(diagnostics, at, problem) {
  diagnostics.push({
    severity: "warning",
    code: "settings-value-conflict",
    message: `${at} ${problem} in ${SETTINGS}, so the declared settings cannot be merged into it.`,
    file: SETTINGS,
    key: at,
  });
}

function reportUnknownSandboxKeys(value, known, at, diagnostics) {
  for (const [name, item] of Object.entries(value)) {
    const here = `${at}.${name}`;

    if (!(name in known)) {
      diagnostics.push({
        severity: "warning",
        code: "sandbox-unknown-key",
        message: `${here} is not a sandbox setting Claude Code documents, so it may do nothing. Check the spelling against https://code.claude.com/docs/en/sandboxing.`,
        key: here,
      });
    } else if (isObject(known[name]) && isObject(item)) {
      reportUnknownSandboxKeys(item, known[name], here, diagnostics);
    }
  }
}

function key(entry) {
  return JSON.stringify(entry);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
