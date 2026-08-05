import assert from "node:assert/strict";
import test from "node:test";

import { makeRepository } from "./helpers.mjs";

const CLAUDE = `# Project

We value small, reviewable changes.

## Testing policy

Run the full suite before merging to main.

## Release policy

Tag releases with semantic versions.
`;

const AGENTS = `## Testing policy

Run the full suite before merging to main.

## Style

Two spaces, no tabs.
`;

async function withExisting(run) {
  const repository = await makeRepository();

  try {
    await repository.write("CLAUDE.md", CLAUDE);
    await repository.write("AGENTS.md", AGENTS);
    await repository.write(".claude/agents/reviewer.md", "---\nname: reviewer\n---\nYou review code.\n");
    await repository.write(".cursor/rules/design.mdc", "Prefer composition over inheritance.\n");
    await run(repository);
  } finally {
    await repository.cleanup();
  }
}

test("adopt previews without writing anything", async () => {
  await withExisting(async (repository) => {
    const before = await repository.fingerprint();
    const result = repository.run("adopt");

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Would adopt:/);
    assert.match(result.stdout, /dry run/);
    assert.equal(await repository.fingerprint(), before, "a dry run must not write");
  });
});

test("adopt splits documents by heading and never touches the originals", async () => {
  await withExisting(async (repository) => {
    const result = repository.run("adopt", "--write");

    assert.equal(result.code, 0, result.stderr);

    assert.equal(await repository.read("CLAUDE.md"), CLAUDE, "originals are left alone");
    assert.equal(await repository.read("AGENTS.md"), AGENTS);

    assert.match(await repository.read(".ai/rules/testing-policy.md"), /adopted-from: CLAUDE\.md/);
    assert.match(await repository.read(".ai/rules/release-policy.md"), /semantic versions/);
    assert.match(await repository.read(".ai/rules/claude-preamble.md"), /small, reviewable/);
    assert.match(await repository.read(".ai/agents/reviewer.md"), /You review code/);
    assert.match(await repository.read(".ai/rules/design.md"), /composition over inheritance/);
  });
});

test("adopt surfaces drifted copies instead of merging them", async () => {
  await withExisting(async (repository) => {
    const result = repository.run("adopt");

    assert.match(result.stdout, /Probable duplicates/);
    assert.match(result.stdout, /testing-policy\.md.*testing-policy-2\.md/);
  });
});

test("an adopted workspace validates and compiles", async () => {
  await withExisting(async (repository) => {
    repository.run("adopt", "--write");

    const validate = repository.run("validate", "--strict");

    assert.equal(validate.code, 0, validate.stderr);

    const manifest = await repository.read(".ai/manifest.yaml");

    assert.match(manifest, /^ {2}- testing-policy$/m, "names are appended as a block list");
    assert.match(manifest, /^ {2}- reviewer$/m);

    const sync = repository.run("sync");

    assert.equal(sync.code, 1, "the original files are reported rather than overwritten");
    assert.match(sync.stderr, /CLAUDE\.md/);

    const forced = repository.run("sync", "--force");

    assert.equal(forced.code, 0, forced.stderr);
    assert.match(await repository.read("CLAUDE.md"), /DO NOT EDIT/);
  });
});

test("adopt is idempotent", async () => {
  await withExisting(async (repository) => {
    repository.run("adopt", "--write");

    const before = await repository.fingerprint();
    const second = repository.run("adopt", "--write");

    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /Nothing to adopt/);
    assert.equal(await repository.fingerprint(), before);
  });
});

test("adopt ignores files this compiler generated", async () => {
  const repository = await makeRepository();

  try {
    repository.run("init");
    repository.run("sync");

    const result = repository.run("adopt");

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Nothing to adopt/);
  } finally {
    await repository.cleanup();
  }
});

test("adopt does not re-import generated agents and commands", async () => {
  const repository = await makeRepository();

  try {
    // Agent and command files are verbatim copies with no banner to recognize,
    // so only the ownership record can tell them apart from user sources.
    await repository.write(".ai/blueprint.yaml", [
      "schema: 2",
      "workflow:",
      "  development: spec-driven",
      "ai:",
      "  runtimes: [claude, codex]",
      "",
    ].join("\n"));
    repository.run("sync");

    assert.equal(await repository.exists(".claude/agents/spec-author.md"), true);

    const result = repository.run("adopt");

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Nothing to adopt/);
    assert.equal(await repository.exists(".ai/agents/spec-author.md"), false);
  } finally {
    await repository.cleanup();
  }
});

test("adopt reports nothing to do in an untouched repository", async () => {
  const repository = await makeRepository();

  try {
    const result = repository.run("adopt");

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /No existing assistant instruction files were found/);
  } finally {
    await repository.cleanup();
  }
});
