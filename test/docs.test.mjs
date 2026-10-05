import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { fileExists, projectRoot } from "./helpers.mjs";

/**
 * The threat model makes claims about this compiler that tests demonstrate.
 * These checks keep its references from rotting: a cited test that was renamed,
 * or a code that no longer exists, would quietly turn a claim into fiction.
 */

const THREAT_MODEL = path.join(projectRoot, "docs", "threat-model.md");

async function sourceText() {
  const texts = [];

  for (const directory of ["src", "packs"]) {
    for (const entry of await fs.readdir(path.join(projectRoot, directory), { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        texts.push(await fs.readFile(path.join(entry.parentPath ?? entry.path, entry.name), "utf8"));
      }
    }
  }

  return texts.join("\n");
}

test("every test the threat model cites exists", async () => {
  const text = await fs.readFile(THREAT_MODEL, "utf8");
  const cited = [...new Set(text.match(/test\/[a-z0-9-]+\.test\.mjs/g))];

  assert.ok(cited.length >= 5, "the threat model cites its evidence");

  for (const file of cited) {
    assert.ok(await fileExists(path.join(projectRoot, file)), `${file} is cited but does not exist`);
  }
});

test("every code and contribution the threat model names exists in the source", async () => {
  const text = await fs.readFile(THREAT_MODEL, "utf8");
  const source = await sourceText();
  const names = [...new Set([...text.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((match) => match[1]))];

  assert.ok(names.includes("permission-conflict"));

  for (const name of names) {
    assert.ok(source.includes(name), `\`${name}\` is named in the threat model but appears nowhere in src/ or packs/`);
  }
});
