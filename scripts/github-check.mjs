#!/usr/bin/env node

/**
 * Runs `aie check` and turns its JSON into GitHub annotations and a job
 * summary, so drift shows up on the changed files rather than only in the log.
 *
 * Then runs `aie audit` unless AIE_AUDIT is "off". In "warn" mode (the
 * default) findings are annotated as warnings and never fail the job; in
 * "fail" mode error findings are errors and the audit's exit code counts.
 *
 * Exit codes match the CLI: 0 clean, 1 out of date or failed audit, 2 broken
 * workspace.
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
const auditMode = process.env.AIE_AUDIT || "warn";

if (!["warn", "fail", "off"].includes(auditMode)) {
  console.error(`::error::Unknown audit mode "${auditMode}". Use warn, fail, or off.`);
  process.exit(2);
}

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

const auditStatus = auditMode === "off" ? 0 : runAudit();

process.exit(Math.max(result.status ?? 0, auditStatus));

function runAudit() {
  const audit = spawnSync(
    process.execPath,
    [bin, "audit", "--json", ...(strict && auditMode === "fail" ? ["--strict"] : [])],
    { encoding: "utf8" }
  );
  const report = parse(audit.stdout);

  if (!report?.findings) {
    annotate(auditMode === "fail" ? "error" : "warning", `aie audit could not run: ${report?.error ?? audit.stderr}`, undefined);
    return auditMode === "fail" ? (audit.status ?? 2) : 0;
  }

  const rows = [];

  for (const finding of report.findings) {
    const level = auditMode === "fail" && finding.severity === "error" ? "error" : "warning";

    annotate(level, `${finding.code}: ${finding.message} Fix: ${finding.fix}`, finding.file);
    rows.push(`| \`${finding.code}\` | ${finding.severity} | ${finding.file ? `\`${finding.file}\`` : ""} | ${finding.fix.replace(/\|/g, "\\|")} |`);
  }

  summary(rows.length
    ? ["### Audit", "", "| Finding | Severity | File | Fix |", "| --- | --- | --- | --- |", ...rows]
    : ["### Audit", "", "✓ No findings."]);

  return auditMode === "fail" ? (audit.status ?? 0) : 0;
}

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
