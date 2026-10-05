import assert from "node:assert/strict";
import test from "node:test";

import { initializedRepository, makeRepository } from "./helpers.mjs";

const SETTINGS = ".claude/settings.json";
const HARDENED_DENY = ["Read(.env)", "Read(.env.*)", "Read(*.pem)", "Read(*.key)"];

function manifest(extra = "", { codexAccept = true } = {}) {
  return [
    "version: 1",
    "targets:",
    "  claude:",
    "    enabled: true",
    "  codex:",
    "    enabled: true",
    ...(codexAccept ? ["    accept: [permissions-unsupported, sandbox-unsupported]"] : []),
    "agents: []",
    "rules: [project]",
    "commands: []",
    "security: hardened",
    extra,
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

  return { ...result, payload: JSON.parse(result.stdout) };
}

const codes = (result) => (result.payload.diagnostics ?? []).map((entry) => entry.code);

test("security: hardened compiles to the secret deny rules and the sandbox", async () => {
  await withRepository(manifest(), async (repository) => {
    const result = sync(repository);

    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(JSON.parse(await repository.read(SETTINGS)), {
      permissions: { deny: HARDENED_DENY },
      sandbox: { enabled: true },
    });
  });
});

test("explicit permissions and sandbox combine with the preset, and deny wins", async () => {
  await withRepository(manifest([
    'permissions: {"allow": ["Bash(npm test)", "Read(.env)"], "deny": ["Read(./secrets/**)"]}',
    'sandbox: {"network": {"allowedDomains": ["registry.npmjs.org"]}}',
  ].join("\n")), async (repository) => {
    const result = sync(repository);

    assert.equal(result.code, 0, result.stdout);
    assert.ok(codes(result).includes("permission-conflict"), "allowing a preset deny is reported");
    assert.deepEqual(JSON.parse(await repository.read(SETTINGS)), {
      permissions: { allow: ["Bash(npm test)"], deny: [...HARDENED_DENY, "Read(./secrets/**)"] },
      sandbox: { enabled: true, network: { allowedDomains: ["registry.npmjs.org"] } },
    });
  });
});

test("contradicting the preset is an error", async () => {
  await withRepository(manifest('sandbox: {"enabled": false}'), async (repository) => {
    const result = repository.run("validate");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /hardened/);
    assert.equal(await repository.exists(SETTINGS), false);
  });
});

test("an unknown preset is an error that lists the presets", async () => {
  await withRepository(manifest().replace("security: hardened", "security: paranoid"), async (repository) => {
    const result = repository.run("validate");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /hardened/);
  });
});

test("Codex still warns about the preset unless the gap is accepted", async () => {
  await withRepository(manifest("", { codexAccept: false }), async (repository) => {
    const result = sync(repository);

    assert.ok(codes(result).includes("permissions-unsupported"));
    assert.ok(codes(result).includes("sandbox-unsupported"));
    assert.equal(repository.run("validate", "--strict").code, 1);
  });
});

test("a blueprint takes the preset after the pack's permission groups", async () => {
  const repository = await makeRepository();

  try {
    await repository.write(".ai/blueprint.yaml", `schema: 2
workflow:
  development: spec-driven
ai:
  runtimes: [claude]
security: hardened
`);

    const result = sync(repository);

    assert.equal(result.code, 0, result.stdout);

    const settings = JSON.parse(await repository.read(SETTINGS));

    assert.deepEqual(settings.permissions.deny, [
      "Edit(./.claude/settings.json)",
      "Edit(./.claude/settings.local.json)",
      "Edit(./.claude/hooks/**)",
      "Edit(./.ai/generated/**)",
      ...HARDENED_DENY,
    ]);
    assert.deepEqual(settings.sandbox, { enabled: true });
  } finally {
    await repository.cleanup();
  }
});

for (const style of ["manifest", "blueprint"]) {
  test(`init --secure (${style}) passes --strict and audits clean on the first sync`, async () => {
    const repository = await makeRepository();

    try {
      const init = repository.run("init", "--secure", ...(style === "blueprint" ? ["--blueprint"] : []));

      assert.equal(init.code, 0, init.stderr);

      const source = await repository.read(style === "blueprint" ? ".ai/blueprint.yaml" : ".ai/manifest.yaml");

      assert.match(source, /^security: hardened$/m);
      assert.match(source, /sandbox-unsupported/, "the Codex gaps are accepted in the file, visibly");

      assert.equal(repository.run("sync", "--strict").code, 0);
      assert.equal(repository.run("validate", "--strict").code, 0);

      const audit = JSON.parse(repository.run("audit", "--json").stdout);

      // A blueprint ships the spec-driven commit hook, whose CI check belongs
      // in the project's own pipeline; until it is added, audit says so.
      assert.deepEqual(
        audit.findings.map((item) => item.code),
        style === "blueprint" ? ["hook-no-ci-backstop"] : []
      );
    } finally {
      await repository.cleanup();
    }
  });
}

test("init without --secure stays as before", async () => {
  const repository = await makeRepository();

  try {
    assert.equal(repository.run("init").code, 0);
    assert.doesNotMatch(await repository.read(".ai/manifest.yaml"), /security:/);
  } finally {
    await repository.cleanup();
  }
});

test("audit points at the preset as the fix", async () => {
  const repository = await makeRepository();

  try {
    const audit = JSON.parse(repository.run("audit", "--json").stdout);
    const fixes = audit.findings.filter((item) => ["deny-empty", "sandbox-disabled"].includes(item.code));

    assert.equal(fixes.length, 2);
    for (const finding of fixes) {
      assert.match(finding.fix, /security: hardened/);
    }
  } finally {
    await repository.cleanup();
  }
});

test("a hardened workspace compiles byte-identically twice", async () => {
  await withRepository(manifest(), async (repository) => {
    assert.equal(sync(repository).code, 0);
    const first = await repository.fingerprint();
    assert.equal(sync(repository).code, 0);
    assert.equal(await repository.fingerprint(), first);
  });
});
