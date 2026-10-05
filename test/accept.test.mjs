import assert from "node:assert/strict";
import test from "node:test";

import { initializedRepository, makeRepository } from "./helpers.mjs";

function manifest({ targets = { claude: [], codex: [] }, permissions = true } = {}) {
  return [
    "version: 1",
    "targets:",
    ...Object.entries(targets).flatMap(([id, accept]) => [
      `  ${id}:`,
      "    enabled: true",
      ...(accept?.length ? [`    accept: ${JSON.stringify(accept)}`] : []),
    ]),
    "agents: []",
    "rules:",
    "  - project",
    "commands: []",
    ...(permissions ? ['permissions: {"deny": ["Read(.env)"]}'] : []),
    "",
  ].join("\n");
}

async function withRepository(contents, run) {
  const repository = await initializedRepository();

  try {
    await repository.write(".ai/manifest.yaml", contents);
    await run(repository);
  } finally {
    await repository.cleanup();
  }
}

function sync(repository, ...flags) {
  const result = repository.run("sync", "--json", ...flags);
  const payload = JSON.parse(result.stdout);

  return { ...result, payload, diagnostics: payload.diagnostics ?? [] };
}

const byCode = (result, code) => result.diagnostics.filter((entry) => entry.code === code);

test("an accepted gap is info, marked accepted, and passes --strict", async () => {
  await withRepository(manifest({ targets: { claude: [], codex: ["permissions-unsupported"] } }), async (repository) => {
    const result = sync(repository, "--strict");

    assert.equal(result.code, 0, result.stdout);

    const [entry] = byCode(result, "permissions-unsupported");

    assert.equal(entry.severity, "info");
    assert.equal(entry.accepted, true);
    assert.equal(entry.target, "codex");
    assert.match(entry.message, /accepted/i);
    assert.equal(repository.run("validate", "--strict").code, 0);
  });
});

test("without accept, the gap still fails --strict", async () => {
  await withRepository(manifest(), async (repository) => {
    assert.equal(repository.run("validate", "--strict").code, 1);
    assert.equal(byCode(sync(repository), "permissions-unsupported")[0].severity, "warning");
  });
});

test("acceptance is per target", async () => {
  await withRepository(manifest({ targets: { claude: [], codex: ["permissions-unsupported"], cursor: [] } }), async (repository) => {
    const entries = byCode(sync(repository), "permissions-unsupported");

    assert.deepEqual(
      entries.map((entry) => `${entry.target} ${entry.severity}`).sort(),
      ["codex info", "cursor warning"]
    );
    assert.equal(repository.run("validate", "--strict").code, 1);
  });
});

test("accept-unused fires for a code the target never emits", async () => {
  await withRepository(manifest({ targets: { claude: [], codex: ["permissions-unsupported", "sandbox-unsupported"] } }), async (repository) => {
    const result = sync(repository);
    const unused = byCode(result, "accept-unused");

    assert.equal(unused.length, 1);
    assert.equal(unused[0].severity, "warning");
    assert.equal(unused[0].target, "codex");
    assert.match(unused[0].message, /sandbox-unsupported/);
    assert.equal(repository.run("validate", "--strict").code, 1);
  });
});

test("accept-unused fires when the reason went away", async () => {
  await withRepository(manifest({ targets: { claude: [], codex: ["permissions-unsupported"] }, permissions: false }), async (repository) => {
    assert.equal(byCode(sync(repository), "accept-unused").length, 1);
  });
});

test("accept-unused stays quiet when every accepted code fires", async () => {
  await withRepository(manifest({ targets: { claude: [], codex: ["permissions-unsupported"] } }), async (repository) => {
    assert.equal(byCode(sync(repository), "accept-unused").length, 0);
  });
});

test("only capability gaps can be accepted", async () => {
  for (const code of ["settings-entry-modified", "made-up-code"]) {
    await withRepository(manifest({ targets: { claude: [], codex: [code] } }), async (repository) => {
      const result = repository.run("validate");

      assert.equal(result.code, 1, code);
      assert.match(result.stderr, /permissions-unsupported/, "the error lists what can be accepted");
    });
  }

  await withRepository(manifest().replace("    enabled: true\nagents", "    enabled: true\n    accept: permissions-unsupported\nagents"), async (repository) => {
    assert.equal(repository.run("validate").code, 1, "accept must be a list");
  });
});

test("a blueprint accepts gaps under ai.accept", async () => {
  const repository = await makeRepository();

  try {
    await repository.write(".ai/blueprint.yaml", `schema: 2
workflow:
  development: spec-driven
ai:
  runtimes: [claude, codex]
  accept:
    codex: [permissions-unsupported, capability-unsupported]
`);

    const result = sync(repository, "--strict");

    assert.equal(result.code, 0, result.stdout);
    assert.equal(byCode(result, "permissions-unsupported")[0].accepted, true);
    assert.equal(byCode(result, "accept-unused").length, 0);

    await repository.write(".ai/blueprint.yaml", `schema: 2
workflow:
  development: spec-driven
ai:
  runtimes: [claude, codex]
  accept:
    cursor: [permissions-unsupported]
`);

    assert.equal(repository.run("validate").code, 1, "accepting for a runtime the blueprint does not target is an error");
  } finally {
    await repository.cleanup();
  }
});
