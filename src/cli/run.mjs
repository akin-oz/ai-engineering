import process from "node:process";

import { DiagnosticError } from "../diagnostics.mjs";
import { VERSION } from "../version.mjs";

const CHECK_LABELS = {
  created: ["missing", "would create"],
  updated: ["drift", "would update"],
  unchanged: ["ok", ""],
};

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_WORKSPACE_ERROR = 2;

export async function run(argv, options = {}) {
  const { command, flags, unknown } = parseArguments(argv);
  const root = options.root ?? process.cwd();

  if (unknown) {
    return report(new Error(`Unknown option "${unknown}". Use "aie --help" for usage.`), flags);
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return EXIT_OK;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(VERSION);
    return EXIT_OK;
  }

  try {
    if (command === "init") {
      return await runInit(root, flags);
    }

    if (command === "sync") {
      return flags.dryRun ? await runCheck(root, flags) : await runSync(root, flags);
    }

    if (command === "check") {
      return await runCheck(root, flags);
    }

    if (command === "validate") {
      return await runValidate(root, flags);
    }

    if (command === "explain") {
      return await runExplain(root, flags);
    }

    if (command === "adopt") {
      return await runAdopt(root, flags);
    }
  } catch (error) {
    return report(error, flags, command === "check" ? EXIT_WORKSPACE_ERROR : EXIT_FAILED);
  }

  return report(new Error(`Unknown command "${command}". Use "aie --help" for usage.`), flags);
}

async function runInit(root, flags) {
  const { initializeWorkspace } = await import("../workspace/init.mjs");
  const result = await initializeWorkspace(root, { blueprint: flags.blueprint });

  if (flags.json) {
    console.log(JSON.stringify({ ok: true, created: result.created }, null, 2));
    return EXIT_OK;
  }

  if (result.created.length) {
    for (const item of result.created) {
      console.log(`✓ Created ${item}`);
    }
  } else {
    console.log("✓ .ai workspace already exists");
  }

  if (result.existingRuntimeFiles.length) {
    console.log(`
Note: ${result.existingRuntimeFiles.join(" and ")} already exists. "aie sync"
will not overwrite files it did not generate; it reports them and stops.`);
  }

  console.log(flags.blueprint
    ? `
Next steps:

1. Run: aie sync
   → composes the workflow into .ai/generated/, then generates CLAUDE.md,
     AGENTS.md, and .claude/
2. Run "aie explain" to see what the workflow contributed
3. Add your own rules and agents under .ai/ — they compile alongside the pack`
    : `
Next steps:

1. Edit .ai/rules/project.md (it is loaded by every assistant)
2. Add more rules and agents under .ai/, list them in .ai/manifest.yaml
3. Run: aie sync
   → generates CLAUDE.md, AGENTS.md, .claude/`);

  return EXIT_OK;
}

async function runSync(root, flags) {
  const { compile } = await import("../compiler/compile.mjs");
  const result = await compile({ root, strict: flags.strict, force: flags.force });

  if (flags.json) {
    console.log(JSON.stringify(toJson(result, "sync"), null, 2));
    return EXIT_OK;
  }

  for (const target of result.targets) {
    console.log(target.id);

    for (const artifact of target.artifacts) {
      console.log(`  ${pad(artifact.action)} ${artifact.path}`);
    }

    for (const removed of target.removed) {
      console.log(`  ${pad("removed")} ${removed}`);
    }
  }

  printDiagnostics(result.diagnostics, flags);

  return EXIT_OK;
}

async function runCheck(root, flags) {
  const { inspect } = await import("../compiler/compile.mjs");
  const result = await inspect({ root, strict: flags.strict });

  if (result.collisions.length) {
    return report(collisionMessage(result.collisions), flags, EXIT_WORKSPACE_ERROR);
  }

  if (flags.json) {
    console.log(JSON.stringify(toJson(result, "check"), null, 2));
    return result.changed ? EXIT_FAILED : EXIT_OK;
  }

  for (const target of result.targets) {
    console.log(target.id);

    for (const artifact of target.artifacts) {
      const [label, detail] = CHECK_LABELS[artifact.action] ?? [artifact.action, ""];

      console.log(`  ${pad(label)} ${artifact.path}${detail ? `  (${detail})` : ""}`);
    }

    for (const removed of target.removed) {
      console.log(`  ${pad("stale")} ${removed}  (would remove)`);
    }
  }

  printDiagnostics(result.diagnostics, flags);

  if (result.changed) {
    console.log("\nGenerated artifacts are out of date. Run: aie sync");
    return EXIT_FAILED;
  }

  console.log("\nGenerated artifacts are up to date.");

  return EXIT_OK;
}

async function runValidate(root, flags) {
  const { validate } = await import("../compiler/compile.mjs");
  const result = await validate({ root, strict: flags.strict });

  if (flags.json) {
    console.log(JSON.stringify({
      ok: true,
      diagnostics: result.diagnostics.entries,
    }, null, 2));
    return EXIT_OK;
  }

  console.log(".ai workspace is valid.");
  printDiagnostics(result.diagnostics, flags);

  return EXIT_OK;
}

async function runExplain(root, flags) {
  const { plan } = await import("../compiler/compile.mjs");
  const result = await plan({ root, strict: flags.strict });
  const { workflow } = result.manifest;

  if (flags.json) {
    console.log(JSON.stringify({ ok: true, workflow: workflow ?? null }, null, 2));
    return EXIT_OK;
  }

  if (!workflow) {
    console.log(`This workspace lists its sources by hand in .ai/manifest.yaml.

Nothing composes them, so there is nothing to explain. Workflow composition
applies to blueprint workspaces (.ai/blueprint.yaml).`);
    return EXIT_OK;
  }

  console.log(`workflow: ${workflow.development} (${workflow.pack.id}@${workflow.pack.version})`);

  const support = capabilitySupport(result.registry, result.manifest);

  for (const kind of ["agents", "rules", "commands", "templates"]) {
    for (const id of workflow.contributions[kind] ?? []) {
      const targets = kind === "templates" ? ["source only"] : support[kind];

      console.log(`  ${kind.slice(0, -1).padEnd(8)} ${id.padEnd(18)} → ${targets.join(", ")}`);
    }
  }

  printDiagnostics(result.diagnostics, flags);

  return EXIT_OK;
}

function capabilitySupport(registry, manifest) {
  const enabled = registry.filter((adapter) => manifest.targets[adapter.id]?.enabled !== false
    && manifest.targets[adapter.id]);
  const support = {};

  for (const kind of ["agents", "rules", "commands"]) {
    const yes = [];
    const no = [];

    for (const adapter of enabled) {
      const capability = adapter.capabilities?.[kind] ?? "native";

      (capability === "unsupported" ? no : yes).push(adapter.id);
    }

    support[kind] = [
      ...yes,
      ...no.map((id) => `${id}: unsupported`),
    ];
  }

  return support;
}

async function runAdopt(root, flags) {
  const { adopt } = await import("../workspace/adopt.mjs");
  const result = await adopt(root, { write: flags.write });

  if (flags.json) {
    console.log(JSON.stringify({
      ok: true,
      written: result.written,
      writes: result.writes.map((item) => ({ path: item.path, source: item.source })),
      skipped: result.skipped,
      duplicates: result.duplicates,
      manifest: { path: result.manifest.path, added: result.manifest.added },
    }, null, 2));
    return EXIT_OK;
  }

  if (!result.writes.length) {
    console.log(result.skipped.length
      ? "Nothing to adopt. Every instruction file found was already generated or already adopted."
      : "Nothing to adopt. No existing assistant instruction files were found.");
    return EXIT_OK;
  }

  console.log(result.written ? "Adopted:" : "Would adopt:");

  for (const item of result.writes) {
    console.log(`  ${item.path.padEnd(40)} ← ${item.source}${item.heading ? ` (## ${item.heading})` : ""}`);
  }

  for (const [kind, ids] of Object.entries(result.manifest.added)) {
    console.log(`\n  ${result.manifest.path}: ${kind} += ${ids.join(", ")}`);
  }

  if (result.skipped.length) {
    console.log("\nSkipped:");

    for (const item of result.skipped) {
      console.log(`  ${item.source} (${item.reason})`);
    }
  }

  if (result.duplicates.length) {
    console.log("\nProbable duplicates — the same policy written twice. Review and merge by hand:");

    for (const item of result.duplicates) {
      console.log(`  ${item.similarity}% similar: ${item.paths.join("  ↔  ")}`);
    }
  }

  console.log(result.written
    ? `
Originals were not modified. Next:

1. Review .ai/ and merge any duplicates listed above
2. Run: aie sync
3. Your original files are reported as collisions — check the diff, then run
   "aie sync --force" once you trust the generated output`
    : `
This was a dry run. Nothing was written. Run "aie adopt --write" to apply it.`);

  return EXIT_OK;
}

function toJson(result, command) {
  return {
    ok: true,
    command,
    changed: result.changed,
    targets: result.targets.map((target) => ({
      id: target.id,
      artifacts: target.artifacts.map((artifact) => ({
        path: artifact.path,
        action: artifact.action,
        kind: artifact.kind,
      })),
      removed: target.removed,
    })),
    diagnostics: result.diagnostics.entries,
  };
}

function printDiagnostics(diagnostics, flags) {
  const entries = diagnostics?.entries ?? [];

  if (!entries.length) {
    return;
  }

  console.log("");

  for (const entry of entries) {
    const location = entry.file ? ` (${entry.file})` : "";

    console.log(`${entry.severity}: ${entry.message}${location}`);
  }

  const warnings = entries.filter((entry) => entry.severity === "warning").length;

  if (warnings && !flags.strict) {
    console.log(`\n${warnings} warning(s). Run with --strict to fail on warnings.`);
  }
}

function report(error, flags, exitCode = EXIT_FAILED) {
  const message = error instanceof Error ? error.message : String(error);
  const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [];

  if (flags?.json) {
    console.log(JSON.stringify({ ok: false, error: message, diagnostics }, null, 2));
    return exitCode;
  }

  console.error(`Error: ${message}`);

  return exitCode;
}

function collisionMessage(collisions) {
  const list = collisions.map((item) => `  ${item.path} (${item.target})`).join("\n");

  return new DiagnosticError(
    `Refusing to overwrite files this workspace does not own:\n\n${list}\n\n` +
    "Move them aside, or run \"aie sync --force\" to overwrite them and take ownership.",
    collisions.map((item) => ({
      severity: "error",
      code: "output-collision",
      message: `"${item.path}" already exists and was not generated by this workspace`,
      file: item.path,
      target: item.target,
    }))
  );
}

function parseArguments(argv) {
  const flags = {
    json: false,
    strict: false,
    force: false,
    dryRun: false,
    blueprint: false,
    write: false,
  };
  const positional = [];
  let unknown;

  for (const argument of argv) {
    if (argument === "--json") {
      flags.json = true;
    } else if (argument === "--strict") {
      flags.strict = true;
    } else if (argument === "--force") {
      flags.force = true;
    } else if (argument === "--dry-run") {
      flags.dryRun = true;
    } else if (argument === "--blueprint") {
      flags.blueprint = true;
    } else if (argument === "--write") {
      flags.write = true;
    } else if (argument.startsWith("-") && !isCommandAlias(argument)) {
      unknown ??= argument;
    } else {
      positional.push(argument);
    }
  }

  return { command: positional[0] ?? "sync", flags, unknown };
}

function isCommandAlias(argument) {
  return ["--help", "-h", "--version", "-v"].includes(argument);
}

function pad(label) {
  return label.padEnd(9, " ");
}

function printHelp() {
  console.log(`AI Engineering Compiler ${VERSION}

Usage:
  aie init        Create a .ai workspace with a starter rule
  aie adopt       Import existing assistant files into .ai (dry run by default)
  aie sync        Compile enabled runtime targets
  aie check       Report whether generated artifacts are up to date
  aie validate    Validate the .ai workspace without comparing output
  aie explain     Show which workflow produced the composed sources
  aie --help      Show this help
  aie --version   Show the installed version

Options:
  --strict        Treat warnings as errors
  --force         Overwrite files the workspace does not own (sync)
  --dry-run       Report what sync would change without writing
  --blueprint     Initialize a workflow blueprint instead of a manifest (init)
  --write         Apply the adoption plan instead of previewing it (adopt)
  --json          Emit machine-readable output

Exit codes:
  0  success
  1  failure, or (for check) generated artifacts are out of date
  2  the workspace could not be compiled`);
}
