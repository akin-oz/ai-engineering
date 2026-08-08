import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { createDiagnostics, fail } from "../diagnostics.mjs";
import { listMarkdown, readText } from "../filesystem.mjs";
import { describeSource, loadHooks } from "./sources.mjs";
import { createFileMap, finalizeManifest, normalizeTargets } from "./normalize.mjs";

const BLUEPRINT_VERSION = 2;
const PACKS = fileURLToPath(new URL("../../packs/", import.meta.url));

const TOP_LEVEL = new Set(["schema", "project", "stack", "workflow", "ai", "hooks"]);
const PROJECT_KEYS = new Set(["type"]);
const STACK_KEYS = new Set(["language", "runtime"]);
const WORKFLOW_KEYS = new Set(["development", "disable"]);

const CONTRIBUTION_ID = /^(agent|rule|command|template|hook)\.[a-z0-9][a-z0-9-]*$/;
const AI_KEYS = new Set(["runtimes"]);

const PROJECT_TYPES = new Set(["library", "saas", "cli", "research", "monorepo"]);

/** One workflow, resolved by name. The composition engine stays unbuilt until this has users. */
const WORKFLOWS = { "spec-driven": "development/spec-driven" };

const CONTRIBUTION_KINDS = ["agents", "rules", "commands", "templates"];

export async function loadBlueprint(root, options = {}) {
  const diagnostics = options.diagnostics ?? createDiagnostics();
  const sourceRoot = path.join(root, ".ai");
  const file = path.join(sourceRoot, "blueprint.yaml");
  const relative = path.relative(root, file);

  let raw;

  try {
    raw = parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    fail(`Blueprint YAML is invalid: ${error.message}`, { file: relative });
  }

  const blueprint = validateBlueprint(raw, relative);
  const pack = disableContributions(
    await loadPack(WORKFLOWS[blueprint.workflow.development]),
    blueprint.workflow.disable ?? [],
    relative
  );

  const targets = normalizeTargets(
    Object.fromEntries(blueprint.ai.runtimes.map((runtime) => [runtime, { enabled: true }])),
    root
  );
  const files = createFileMap(root, sourceRoot, targets);

  const contributions = materialize(pack, files.generated, root);
  const names = {};
  const sources = {};

  for (const kind of ["agents", "rules", "commands"]) {
    const entries = contributions[kind].map((entry) =>
      describeSource(kind, entry.id, entry.contents, entry.absolute, entry.path, diagnostics));

    const local = await loadLocal(kind, files[kind], root, diagnostics, new Set(entries.map((e) => e?.id)));

    sources[kind] = [...entries.filter(Boolean), ...local];
    names[kind] = sources[kind].map((entry) => entry.id);
  }

  const scripts = materializeHookScripts(pack, files.generated, root);
  const seen = new Set();

  // Pack hooks first: a blueprint declaring the same id as the pack is the same
  // conflict as a local rule shadowing a pack rule, and is reported as one.
  const packHooks = await loadHooks(
    pack.hooks.map((hook) => ({ ...hook, run: path.join("generated", "hooks", hook.run) })),
    sourceRoot,
    root,
    diagnostics,
    `${pack.id} pack.yaml`,
    { provided: scripts.provided, seen }
  );

  const localHooks = await loadHooks(
    blueprint.hooks,
    sourceRoot,
    root,
    diagnostics,
    relative,
    { seen }
  );

  sources.hooks = [...packHooks, ...localHooks];

  diagnostics.throwIfFailed();

  return finalizeManifest({
    version: BLUEPRINT_VERSION,
    root,
    sourceRoot,
    targets,
    names,
    sources,
    files,
    generated: [
      ...CONTRIBUTION_KINDS.flatMap((kind) =>
        contributions[kind].map((entry) => ({ path: entry.path, contents: entry.contents }))),
      ...scripts.files,
    ],
    workflow: {
      development: blueprint.workflow.development,
      project: blueprint.project,
      stack: blueprint.stack,
      pack: { id: pack.id, version: pack.version, description: pack.description },
      contributions: {
        ...Object.fromEntries(
          CONTRIBUTION_KINDS.map((kind) => [kind, contributions[kind].map((entry) => entry.id)])
        ),
        hooks: pack.hooks.map((hook) => hook.id),
      },
    },
  });
}

/**
 * Adopting a workflow should not be all or nothing. Disabling names a single
 * contribution, and naming one the pack does not have is an error rather than a
 * silent no-op — a typo here would otherwise look like it worked.
 */
function disableContributions(pack, disable, file) {
  if (!disable.length) {
    return pack;
  }

  const available = new Set([
    ...CONTRIBUTION_KINDS.flatMap((kind) =>
      pack.contributions[kind].map((entry) => `${kind.slice(0, -1)}.${entry.id}`)),
    ...pack.hooks.map((hook) => `hook.${hook.id}`),
  ]);

  for (const id of disable) {
    if (!available.has(id)) {
      fail(
        `Cannot disable "${id}": ${pack.id} does not contribute it. It contributes ${[...available].sort().join(", ")}.`,
        { file }
      );
    }
  }

  const removed = new Set(disable);

  return {
    ...pack,
    contributions: Object.fromEntries(CONTRIBUTION_KINDS.map((kind) => [
      kind,
      pack.contributions[kind].filter((entry) => !removed.has(`${kind.slice(0, -1)}.${entry.id}`)),
    ])),
    hooks: pack.hooks.filter((hook) => !removed.has(`hook.${hook.id}`)),
    scripts: pack.scripts.filter((script) =>
      pack.hooks.some((hook) => hook.run === script.name && !removed.has(`hook.${hook.id}`))),
  };
}

/**
 * Hook scripts a pack ships are materialized like any other generated source,
 * but they must arrive executable: npm does not reliably preserve the mode of
 * files inside a published tarball.
 */
function materializeHookScripts(pack, generatedRoot, root) {
  const relativeRoot = path.relative(root, generatedRoot);
  const provided = new Map();

  const files = pack.scripts.map((script) => {
    const relative = path.join(relativeRoot, "hooks", script.name);
    const absolute = path.join(root, relative);

    provided.set(absolute, { content: script.contents, mode: 0o755 });

    return { path: relative, contents: script.contents, mode: 0o755 };
  });

  return { files, provided };
}

function validateBlueprint(value, file) {
  if (!isObject(value)) {
    fail("Blueprint must contain a YAML object", { file });
  }

  if ((value.schema ?? value.version) !== BLUEPRINT_VERSION) {
    fail(`Unsupported blueprint schema: ${value.schema ?? value.version}`, { file });
  }

  rejectUnknown(value, TOP_LEVEL, "blueprint", file);

  const project = value.project ?? {};
  const stack = value.stack ?? {};
  const workflow = value.workflow ?? {};
  const ai = value.ai ?? {};

  rejectUnknown(project, PROJECT_KEYS, "project", file);
  rejectUnknown(stack, STACK_KEYS, "stack", file);
  rejectUnknown(workflow, WORKFLOW_KEYS, "workflow", file);
  rejectUnknown(ai, AI_KEYS, "ai", file);

  if (project.type !== undefined && !PROJECT_TYPES.has(project.type)) {
    fail(
      `Unknown project type "${project.type}". Supported types are ${[...PROJECT_TYPES].join(", ")}.`,
      { file }
    );
  }

  if (!WORKFLOWS[workflow.development]) {
    fail(
      `Unknown workflow "${workflow.development}". Supported workflows are ${Object.keys(WORKFLOWS).join(", ")}.`,
      { file }
    );
  }

  for (const id of workflow.disable ?? []) {
    if (typeof id !== "string" || !CONTRIBUTION_ID.test(id)) {
      fail(
        `Invalid workflow.disable entry "${id}". Use "<kind>.<id>", for example "hook.spec-trailer".`,
        { file }
      );
    }
  }

  if (!Array.isArray(ai.runtimes) || !ai.runtimes.length) {
    fail('Blueprint must declare at least one runtime in "ai.runtimes"', { file });
  }

  for (const runtime of ai.runtimes) {
    if (typeof runtime !== "string" || !/^[a-z][a-z0-9-]*$/.test(runtime)) {
      fail(`Invalid runtime "${runtime}"`, { file });
    }
  }

  return {
    project,
    stack,
    workflow,
    ai: { runtimes: [...new Set(ai.runtimes)] },
    hooks: value.hooks,
  };
}

function rejectUnknown(value, allowed, subject, file) {
  if (!isObject(value)) {
    fail(`Blueprint "${subject}" must contain a YAML object`, { file });
  }

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`Unknown ${subject} field "${key}"`, { file });
    }
  }
}

async function loadPack(id) {
  const directory = path.join(PACKS, ...id.split("/"));
  let metadata;

  try {
    metadata = parse(await fs.readFile(path.join(directory, "pack.yaml"), "utf8"));
  } catch (error) {
    fail(`Workflow pack "${id}" could not be read: ${error.message}`);
  }

  const contributions = {};

  for (const kind of CONTRIBUTION_KINDS) {
    const declared = metadata.contributes?.[kind] ?? [];
    contributions[kind] = await Promise.all(declared.map(async (name) => ({
      id: name,
      contents: await readText(path.join(directory, kind, `${name}.md`)),
    })));
  }

  const hooks = metadata.contributes?.hooks ?? [];
  const scripts = await Promise.all(
    [...new Set(hooks.map((hook) => hook.run))].map(async (name) => ({
      name,
      contents: await readText(path.join(directory, "hooks", name)),
    }))
  );

  return {
    id: metadata.id ?? id,
    version: metadata.version ?? 1,
    description: metadata.description ?? "",
    contributions,
    hooks,
    scripts,
  };
}

/**
 * Pack contributions become real files under `.ai/generated/`, committed and
 * reviewable, so a diff shows what the blueprint actually produced.
 */
function materialize(pack, generatedRoot, root) {
  const relativeRoot = path.relative(root, generatedRoot);
  const provenance = `${pack.id}@${pack.version}`;

  return Object.fromEntries(CONTRIBUTION_KINDS.map((kind) => [
    kind,
    pack.contributions[kind].map((entry) => {
      const relative = path.join(relativeRoot, kind, `${entry.id}.md`);

      return {
        id: entry.id,
        path: relative,
        absolute: path.join(root, relative),
        contents: stamp(entry.contents, provenance),
      };
    }),
  ]));
}

/**
 * The provenance comment goes after any frontmatter, so a generated agent file
 * stays a valid frontmatter document for the runtime that reads it.
 */
function stamp(contents, provenance) {
  const comment = `<!-- generated-by: ${provenance} — edit the blueprint, not this file -->\n`;
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/.exec(contents);

  if (!match) {
    return comment + contents;
  }

  return contents.slice(0, match[0].length) + comment + contents.slice(match[0].length);
}

async function loadLocal(kind, directory, root, diagnostics, reserved) {
  const entries = [];

  for (const name of await listMarkdown(directory)) {
    const id = name.slice(0, -3);
    const file = path.join(directory, name);
    const relative = path.relative(root, file);

    if (reserved.has(id)) {
      diagnostics.error(
        "workflow-conflict",
        `"${id}" is contributed by the workflow pack and cannot be redefined locally. Rename this file.`,
        { file: relative }
      );
      continue;
    }

    const entry = describeSource(kind, id, await readText(file), file, relative, diagnostics);

    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
