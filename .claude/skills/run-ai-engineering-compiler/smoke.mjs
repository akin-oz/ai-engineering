#!/usr/bin/env node

/**
 * Smoke driver for the ai-engineering compiler CLI.
 *
 * There is no GUI and no server: the "app" is `bin/aie.mjs`, a Node CLI that
 * reads a `.ai/` workspace and compiles runtime files (CLAUDE.md, AGENTS.md,
 * .claude/…). This driver exercises every command in a throwaway workspace and
 * asserts on the two things that are the contract: exit codes and generated
 * files. It also checks the two behaviors that shipped broken in 0.1 and that
 * the project's own rules call out — deterministic (byte-identical) recompiles,
 * and refusing to overwrite files the workspace does not own.
 *
 * Usage:
 *   node .claude/skills/run-ai-engineering-compiler/smoke.mjs
 *
 * Exit 0 = every assertion passed. Exit 1 = at least one failed (details above).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// skill lives at <repo>/.claude/skills/run-ai-engineering-compiler/
const repoRoot = path.resolve(here, "..", "..", "..");
const BIN = path.join(repoRoot, "bin", "aie.mjs");

let failures = 0;

function aie(cwd, args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { code: result.status, out: result.stdout ?? "", err: result.stderr ?? "" };
}

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

function hashTree(dir, files) {
  const hash = createHash("sha256");
  for (const rel of files.sort()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(dir, rel)));
  }
  return hash.digest("hex");
}

function walk(dir, base = dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full));
  }
  return acc;
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aie-smoke-"));
}

console.log(`Driving ${BIN}\n`);

// 1. Meta commands ---------------------------------------------------------
console.log("meta:");
{
  const v = aie(repoRoot, ["--version"]);
  check("--version exits 0", v.code === 0, `exit=${v.code}`);
  check("--version prints a semver", /^\d+\.\d+\.\d+/.test(v.out.trim()), v.out.trim());

  const h = aie(repoRoot, ["--help"]);
  check("--help exits 0", h.code === 0, `exit=${h.code}`);
  check("--help mentions the commands", /aie init[\s\S]*aie sync/.test(h.out));

  const bad = aie(repoRoot, ["frobnicate"]);
  check("unknown command exits 1", bad.code === 1, `exit=${bad.code}`);

  const badFlag = aie(repoRoot, ["sync", "--nope"]);
  check("unknown option exits 1", badFlag.code === 1, `exit=${badFlag.code}`);
}

// 2. Full lifecycle in a fresh workspace -----------------------------------
console.log("\nlifecycle:");
{
  const dir = tmp();
  try {
    const init = aie(dir, ["init"]);
    check("init exits 0", init.code === 0, `exit=${init.code}`);
    check("init creates .ai/manifest.yaml", fs.existsSync(path.join(dir, ".ai/manifest.yaml")));
    check("init creates .ai/rules/project.md", fs.existsSync(path.join(dir, ".ai/rules/project.md")));

    const valid = aie(dir, ["validate"]);
    check("validate exits 0", valid.code === 0, `exit=${valid.code}`);

    const checkBefore = aie(dir, ["check"]);
    check("check before sync exits 1 (out of date)", checkBefore.code === 1, `exit=${checkBefore.code}`);

    const sync = aie(dir, ["sync"]);
    check("sync exits 0", sync.code === 0, `exit=${sync.code}`);
    check("sync writes CLAUDE.md", fs.existsSync(path.join(dir, "CLAUDE.md")));
    check("sync writes AGENTS.md", fs.existsSync(path.join(dir, "AGENTS.md")));
    check(
      "generated CLAUDE.md carries content",
      fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8").length > 80,
    );

    const checkAfter = aie(dir, ["check"]);
    check("check after sync exits 0 (up to date)", checkAfter.code === 0, `exit=${checkAfter.code}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 3. Determinism: two syncs produce a byte-identical tree -------------------
console.log("\ndeterminism:");
{
  const dir = tmp();
  try {
    aie(dir, ["init"]);
    aie(dir, ["sync"]);
    const tracked = ["CLAUDE.md", "AGENTS.md", ...walk(path.join(dir, ".ai/state")).map((p) => path.join(".ai/state", p))];
    const first = hashTree(dir, tracked);
    aie(dir, ["sync"]);
    const second = hashTree(dir, tracked);
    check("recompile is byte-identical", first === second, `${first.slice(0, 8)} vs ${second.slice(0, 8)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 4. Safety: never overwrite files the workspace does not own ---------------
console.log("\nownership guard:");
{
  const dir = tmp();
  try {
    aie(dir, ["init"]);
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "hand-written, not generated\n");
    const sync = aie(dir, ["sync"]);
    check("sync refuses un-owned file (exit 1)", sync.code === 1, `exit=${sync.code}`);
    check("sync explains the refusal", /Refusing to overwrite/.test(sync.err + sync.out));
    check(
      "un-owned CLAUDE.md is left untouched",
      fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8") === "hand-written, not generated\n",
    );

    const chk = aie(dir, ["check"]);
    check("check reports collision as workspace error (exit 2)", chk.code === 2, `exit=${chk.code}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("");
if (failures) {
  console.error(`✗ ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("✓ All smoke assertions passed.");
