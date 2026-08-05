#!/usr/bin/env node

/**
 * Fails when a workspace claims to demonstrate the compiler but compiles to
 * nothing. Version 0.1 shipped six zero-byte source files and a banner-only
 * AGENTS.md while CI stayed green, because empty input compiles deterministically
 * to empty output.
 *
 * Usage: node scripts/verify-dogfood.mjs [directory...]
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parse } from "yaml";

const MINIMUM_CHARACTERS = 80;
const SOURCE_KINDS = ["agents", "rules", "commands"];
const GENERATED = ["CLAUDE.md", "AGENTS.md"];

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["."];
const failures = [];

for (const root of roots) {
  await verify(path.resolve(root));
}

if (failures.length) {
  console.error("Dogfood verification failed:\n");

  for (const failure of failures) {
    console.error(`  ${failure}`);
  }

  console.error("\nA workspace that compiles to nothing is not a demonstration.");
  process.exit(1);
}

console.log(`✓ Verified ${roots.length} workspace(s).`);

async function verify(root) {
  const label = path.relative(process.cwd(), root) || ".";
  const manifestFile = path.join(root, ".ai", "manifest.yaml");
  const manifest = parse(await fs.readFile(manifestFile, "utf8"));

  for (const kind of SOURCE_KINDS) {
    for (const name of await listMarkdown(path.join(root, ".ai", kind))) {
      const file = path.join(root, ".ai", kind, name);
      const contents = (await fs.readFile(file, "utf8")).replace(/\s/g, "");

      if (contents.length < MINIMUM_CHARACTERS) {
        failures.push(
          `${label}/.ai/${kind}/${name} has ${contents.length} non-whitespace characters (minimum ${MINIMUM_CHARACTERS})`
        );
      }
    }
  }

  for (const name of GENERATED) {
    const file = path.join(root, name);
    let contents;

    try {
      contents = await fs.readFile(file, "utf8");
    } catch {
      failures.push(`${label}/${name} is missing. Run: aie sync`);
      continue;
    }

    if (contents.includes("{{")) {
      failures.push(`${label}/${name} contains an unresolved template placeholder`);
    }

    for (const rule of manifest.rules ?? []) {
      if (!contents.includes(`## Rule: ${rule}`)) {
        failures.push(`${label}/${name} does not contain the declared rule "${rule}"`);
      }
    }
  }
}

async function listMarkdown(directory) {
  try {
    return (await fs.readdir(directory)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
}
