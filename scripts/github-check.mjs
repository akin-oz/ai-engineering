#!/usr/bin/env node

/**
 * Runs `aie check` and turns its JSON into GitHub annotations and a job
 * summary, so drift shows up on the changed files rather than only in the log.
 *
 * Exit codes match the CLI: 0 clean, 1 out of date, 2 broken workspace.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const actionPath = process.env.GITHUB_ACTION_PATH
  ?? path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(actionPath, "bin", "aie.mjs");
const strict = process.env.AIE_STRICT !== "false";

const result = spawnSync(
  process.execPath,
  [bin, "check", "--json", ...(strict ? ["--strict"] : [])],
  { encoding: "utf8" }
);

const payload = parse(result.stdout);

if (!payload) {
  console.error(result.stdout || result.stderr || "aie check produced no output.");
  process.exit(result.status ?? 2);
}

const lines = [];

if (payload.ok === false) {
  annotate("error", payload.error, undefined);

  for (const diagnostic of payload.diagnostics ?? []) {
    annotate("error", diagnostic.message, diagnostic.file);
  }

  summary(["## AI Engineering Compiler", "", "The workspace could not be compiled.", "", "```", payload.error, "```"]);
  process.exit(result.status ?? 2);
}

for (const target of payload.targets ?? []) {
  for (const artifact of target.artifacts) {
    if (artifact.action === "unchanged") {
      continue;
    }

    annotate(
      "error",
      `${artifact.path} is out of date (${artifact.action === "created" ? "missing" : "differs from source"}). Run: aie sync`,
      artifact.path
    );

    lines.push(`| \`${artifact.path}\` | ${target.id} | ${artifact.action === "created" ? "missing" : "out of date"} |`);
  }

  for (const removed of target.removed) {
    annotate("error", `${removed} is no longer generated. Run: aie sync`, removed);
    lines.push(`| \`${removed}\` | ${target.id} | stale |`);
  }
}

for (const diagnostic of payload.diagnostics ?? []) {
  if (diagnostic.severity !== "info") {
    annotate(diagnostic.severity === "error" ? "error" : "warning", diagnostic.message, diagnostic.file);
  }
}

summary(lines.length
  ? [
    "## AI Engineering Compiler",
    "",
    "Generated files no longer match their `.ai` source. Run `aie sync` and commit the result.",
    "",
    "| File | Target | Status |",
    "| --- | --- | --- |",
    ...lines,
  ]
  : ["## AI Engineering Compiler", "", "✓ Generated files are up to date."]);

process.exit(result.status ?? 0);

function annotate(level, message, file) {
  const location = file ? ` file=${file}` : "";

  console.log(`::${level}${location}::${String(message).replace(/\n/g, "%0A")}`);
}

function summary(content) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    console.log(content.join("\n"));
    return;
  }

  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${content.join("\n")}\n`);
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
