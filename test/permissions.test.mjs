import assert from "node:assert/strict";
import test from "node:test";

import { initializedRepository } from "./helpers.mjs";

const SETTINGS = ".claude/settings.json";

function manifest({ targets = ["claude"], permissions, sandbox, hooks = false } = {}) {
  return [
    "version: 1",
    "targets:",
    ...targets.flatMap((target) => [`  ${target}:`, "    enabled: true"]),
    "agents: []",
    "rules:",
    "  - project",
    "commands: []",
    ...(hooks ? ["hooks:", "  - id: format-on-write", "    event: post-edit", "    run: hooks/format.sh"] : []),
    ...(permissions ? [`permissions: ${JSON.stringify(permissions)}`] : []),
    ...(sandbox ? [`sandbox: ${JSON.stringify(sandbox)}`] : []),
    "",
  ].join("\n");
}

async function withRepository(run) {
  const repository = await initializedRepository();

  try {
    await repository.write(".ai/hooks/format.sh", "#!/bin/sh\nexit 0\n");
    await run(repository);
  } finally {
    await repository.cleanup();
  }
}

function sync(repository, ...flags) {
  const result = repository.run("sync", "--json", ...flags);
  const payload = JSON.parse(result.stdout);

  return { ...result, payload, codes: payload.diagnostics.map((entry) => entry.code) };
}

async function settings(repository) {
  return JSON.parse(await repository.read(SETTINGS));
}

const DENY = ["Read(./.env)", "Read(./.env.*)"];

test("permissions and sandbox compile into settings.json", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({
      permissions: { allow: ["Bash(npm test)"], deny: DENY },
      sandbox: { enabled: true, network: { allowedDomains: ["registry.npmjs.org"] } },
    }));

    const result = sync(repository);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await settings(repository), {
      permissions: { allow: ["Bash(npm test)"], deny: DENY },
      sandbox: { enabled: true, network: { allowedDomains: ["registry.npmjs.org"] } },
    });
  });
});

test("nothing declared means settings.json is never created", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest());

    assert.equal(sync(repository).code, 0);
    assert.equal(await repository.exists(SETTINGS), false);
  });
});

test("user keys, user entries, and user hooks survive a merge", async () => {
  await withRepository(async (repository) => {
    const user = {
      env: { FOO: "1" },
      permissions: { allow: ["Bash(make)"], deny: ["Read(./secrets/**)"], ask: ["Bash(git push *)"] },
      hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "mine.sh" }] }] },
      sandbox: { excludedCommands: ["docker *"] },
    };

    await repository.write(SETTINGS, `${JSON.stringify(user, null, 2)}\n`);
    await repository.write(".ai/manifest.yaml", manifest({
      hooks: true,
      permissions: { deny: DENY },
      sandbox: { enabled: true },
    }));

    assert.equal(sync(repository).code, 0);

    const merged = await settings(repository);

    assert.deepEqual(merged.env, user.env);
    assert.deepEqual(merged.permissions.allow, ["Bash(make)"]);
    assert.deepEqual(merged.permissions.ask, ["Bash(git push *)"]);
    assert.deepEqual(merged.permissions.deny, ["Read(./secrets/**)", ...DENY]);
    assert.deepEqual(merged.sandbox, { excludedCommands: ["docker *"], enabled: true });
    assert.equal(merged.hooks.PostToolUse.length, 2);
    assert.deepEqual(merged.hooks.PostToolUse[0], user.hooks.PostToolUse[0]);
  });
});

test("removing a declared entry removes exactly that entry", async () => {
  await withRepository(async (repository) => {
    await repository.write(SETTINGS, `${JSON.stringify({ permissions: { deny: ["Read(./secrets/**)"] } }, null, 2)}\n`);
    await repository.write(".ai/manifest.yaml", manifest({ permissions: { deny: DENY }, sandbox: { enabled: true } }));
    assert.equal(sync(repository).code, 0);

    await repository.write(".ai/manifest.yaml", manifest({ permissions: { deny: [DENY[0]] } }));
    assert.equal(sync(repository).code, 0);

    assert.deepEqual(await settings(repository), {
      permissions: { deny: ["Read(./secrets/**)", DENY[0]] },
    });
  });
});

test("an entry the user already had is never claimed, so it survives removal", async () => {
  await withRepository(async (repository) => {
    await repository.write(SETTINGS, `${JSON.stringify({ permissions: { deny: [DENY[0]] } }, null, 2)}\n`);
    await repository.write(".ai/manifest.yaml", manifest({ permissions: { deny: DENY } }));
    assert.equal(sync(repository).code, 0);
    assert.deepEqual((await settings(repository)).permissions.deny, DENY, "no duplicate is added");

    await repository.write(".ai/manifest.yaml", manifest());
    assert.equal(sync(repository).code, 0);

    assert.deepEqual(await settings(repository), { permissions: { deny: [DENY[0]] } });
  });
});

test("settings-value-conflict: a user scalar is kept and reported", async () => {
  await withRepository(async (repository) => {
    await repository.write(SETTINGS, `${JSON.stringify({ sandbox: { enabled: false } }, null, 2)}\n`);
    await repository.write(".ai/manifest.yaml", manifest({ sandbox: { enabled: true } }));

    const result = sync(repository);

    assert.equal(result.code, 0);
    assert.ok(result.codes.includes("settings-value-conflict"));
    assert.equal((await settings(repository)).sandbox.enabled, false);
    assert.equal(sync(repository, "--strict").code, 1, "a weaker compiled policy fails --strict");
  });
});

test("settings-value-conflict stays quiet when the user value agrees or is absent", async () => {
  await withRepository(async (repository) => {
    await repository.write(SETTINGS, `${JSON.stringify({ sandbox: { enabled: true } }, null, 2)}\n`);
    await repository.write(".ai/manifest.yaml", manifest({ sandbox: { enabled: true, failIfUnavailable: true } }));

    const result = sync(repository);

    assert.equal(result.code, 0);
    assert.ok(!result.codes.includes("settings-value-conflict"));
    assert.deepEqual((await settings(repository)).sandbox, { enabled: true, failIfUnavailable: true });

    // The pre-existing value was the user's, so removing it from the manifest leaves it.
    await repository.write(".ai/manifest.yaml", manifest());
    assert.equal(sync(repository).code, 0);
    assert.deepEqual(await settings(repository), { sandbox: { enabled: true } });
  });
});

test("settings-entry-modified: a hand-removed owned entry stops the sync", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({ permissions: { deny: DENY } }));
    assert.equal(sync(repository).code, 0);

    await repository.write(SETTINGS, `${JSON.stringify({ permissions: { deny: [DENY[1]] } }, null, 2)}\n`);
    const before = await repository.read(SETTINGS);
    const result = sync(repository);

    assert.equal(result.code, 1);
    assert.ok(result.payload.diagnostics.some((entry) => entry.code === "settings-entry-modified"));
    assert.equal(await repository.read(SETTINGS), before, "nothing is written");
  });
});

test("settings-entry-modified: a hand-edited owned scalar stops the sync", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({ sandbox: { enabled: true } }));
    assert.equal(sync(repository).code, 0);

    await repository.write(SETTINGS, `${JSON.stringify({ sandbox: { enabled: false } }, null, 2)}\n`);
    const result = sync(repository);

    assert.equal(result.code, 1);
    assert.ok(result.payload.diagnostics.some((entry) => entry.code === "settings-entry-modified"));
  });
});

test("settings-entry-modified stays quiet when owned entries are untouched", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({ permissions: { deny: DENY }, sandbox: { enabled: true } }));
    assert.equal(sync(repository).code, 0);

    const result = sync(repository);

    assert.equal(result.code, 0);
    assert.ok(!result.codes.includes("settings-entry-modified"));
  });
});

test("permission-conflict: deny wins over allow", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({
      permissions: { allow: ["Bash(npm test)", "Read(./.env)"], deny: ["Read(./.env)"] },
    }));

    const result = sync(repository);

    assert.equal(result.code, 0);
    assert.ok(result.codes.includes("permission-conflict"));
    assert.deepEqual((await settings(repository)).permissions, {
      allow: ["Bash(npm test)"],
      deny: ["Read(./.env)"],
    });
  });
});

test("permission-conflict stays quiet without overlap", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({
      permissions: { allow: ["Bash(npm test)", "Bash(npm test)"], deny: DENY },
    }));

    const result = sync(repository);

    assert.equal(result.code, 0);
    assert.ok(!result.codes.includes("permission-conflict"));
    assert.deepEqual((await settings(repository)).permissions.allow, ["Bash(npm test)"], "lists are deduplicated");
  });
});

test("permissions-unsupported and sandbox-unsupported fire for Codex and Cursor", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({
      targets: ["claude", "codex", "cursor"],
      permissions: { deny: DENY },
      sandbox: { enabled: true },
    }));

    const result = sync(repository);
    const unsupported = result.payload.diagnostics.filter((entry) => entry.code.endsWith("-unsupported") && entry.code !== "capability-unsupported");

    assert.equal(result.code, 0);
    assert.deepEqual(
      unsupported.map((entry) => `${entry.severity} ${entry.code}`).sort(),
      [
        "warning permissions-unsupported",
        "warning permissions-unsupported",
        "warning sandbox-unsupported",
        "warning sandbox-unsupported",
      ]
    );
    assert.equal(sync(repository, "--strict").code, 1, "an unenforced policy fails --strict");
  });
});

test("permissions-unsupported and sandbox-unsupported stay quiet when nothing is declared", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({ targets: ["claude", "codex", "cursor"] }));

    const result = sync(repository);

    assert.equal(result.code, 0);
    assert.ok(!result.codes.includes("permissions-unsupported"));
    assert.ok(!result.codes.includes("sandbox-unsupported"));
  });
});

test("sandbox-unknown-key warns, and stays quiet for known keys", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({ sandbox: { enabled: true, enabeld: true, network: { allowedDomans: [] } } }));

    const unknown = sync(repository);
    const flagged = unknown.payload.diagnostics.filter((entry) => entry.code === "sandbox-unknown-key");

    assert.equal(unknown.code, 0);
    assert.deepEqual(flagged.map((entry) => entry.key).sort(), ["sandbox.enabeld", "sandbox.network.allowedDomans"]);

    await repository.write(".ai/manifest.yaml", manifest({
      sandbox: { enabled: true, filesystem: { denyRead: ["~/.aws"] }, network: { allowedDomains: ["github.com"] } },
    }));

    assert.ok(!sync(repository).codes.includes("sandbox-unknown-key"));
  });
});

test("invalid permission shapes are errors", async () => {
  await withRepository(async (repository) => {
    for (const permissions of [{ ask: ["Bash(ls)"] }, { deny: [42] }, { deny: "Read(./.env)" }, ["Read(./.env)"]]) {
      await repository.write(".ai/manifest.yaml", manifest({ permissions }));

      const result = repository.run("sync");

      assert.equal(result.code, 1, JSON.stringify(permissions));
      assert.equal(await repository.exists(SETTINGS), false);
    }

    await repository.write(".ai/manifest.yaml", manifest({ sandbox: ["enabled"] }));
    assert.equal(repository.run("sync").code, 1, "sandbox must be a mapping");
  });
});

test("syncing twice produces a byte-identical tree", async () => {
  await withRepository(async (repository) => {
    await repository.write(SETTINGS, `${JSON.stringify({ permissions: { allow: ["Bash(make)"] } }, null, 2)}\n`);
    await repository.write(".ai/manifest.yaml", manifest({
      hooks: true,
      permissions: { allow: ["Bash(npm test)"], deny: DENY },
      sandbox: { enabled: true, filesystem: { denyRead: ["~/.aws"] } },
    }));

    assert.equal(sync(repository).code, 0);
    const first = await repository.fingerprint();
    assert.equal(sync(repository).code, 0);

    assert.equal(await repository.fingerprint(), first);
    assert.equal(repository.run("check").code, 0);
  });
});

test("a hooks-only ownership record from 0.3 is read and rewritten unchanged", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/manifest.yaml", manifest({ hooks: true }));
    assert.equal(sync(repository).code, 0);

    const record = JSON.parse(await repository.read(".ai/state/targets/claude.json"));

    assert.deepEqual(Object.keys(record.merged[SETTINGS]), ["PostToolUse"], "hook events stay top-level keys");
    assert.equal(repository.run("check").code, 0);
  });
});
