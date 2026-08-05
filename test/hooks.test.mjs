import assert from "node:assert/strict";
import test from "node:test";

import { initializedRepository } from "./helpers.mjs";

const USER_SETTINGS = {
  permissions: { allow: ["Bash(npm test)"] },
  hooks: {
    PostToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "my-own-hook.sh" }] },
    ],
  },
};

function manifest(hooks = true) {
  return [
    "version: 1",
    "targets:",
    "  claude:",
    "    enabled: true",
    "  codex:",
    "    enabled: true",
    "agents: []",
    "rules:",
    "  - project",
    "commands: []",
    ...(hooks
      ? ["hooks:", "  - id: format-on-write", "    event: post-edit", "    run: hooks/format.sh"]
      : []),
    "",
  ].join("\n");
}

async function withHooks(run) {
  const repository = await initializedRepository();

  try {
    await repository.write(".ai/hooks/format.sh", "#!/bin/sh\nexit 0\n");
    await repository.write(".ai/manifest.yaml", manifest());
    await run(repository);
  } finally {
    await repository.cleanup();
  }
}

test("a declared hook compiles to a script and a settings entry", async () => {
  await withHooks(async (repository) => {
    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const settings = JSON.parse(await repository.read(".claude/settings.json"));
    const entries = settings.hooks.PostToolUse;

    assert.equal(entries.length, 1);
    assert.match(entries[0].hooks[0].command, /\.claude\/hooks\/format\.sh$/);
    assert.equal(await repository.exists(".claude/hooks/format.sh"), true);
  });
});

test("merging into settings.json preserves everything the user owns", async () => {
  await withHooks(async (repository) => {
    await repository.write(".claude/settings.json", `${JSON.stringify(USER_SETTINGS, null, 2)}\n`);

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const settings = JSON.parse(await repository.read(".claude/settings.json"));

    assert.deepEqual(settings.permissions, USER_SETTINGS.permissions);
    assert.equal(settings.hooks.PostToolUse.length, 2);
    assert.deepEqual(settings.hooks.PostToolUse[0], USER_SETTINGS.hooks.PostToolUse[0]);
  });
});

test("removing a hook removes only what the compiler put in settings", async () => {
  await withHooks(async (repository) => {
    await repository.write(".claude/settings.json", `${JSON.stringify(USER_SETTINGS, null, 2)}\n`);
    repository.run("sync");

    await repository.write(".ai/manifest.yaml", manifest(false));
    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const settings = JSON.parse(await repository.read(".claude/settings.json"));

    assert.deepEqual(settings.permissions, USER_SETTINGS.permissions);
    assert.deepEqual(settings.hooks.PostToolUse, USER_SETTINGS.hooks.PostToolUse);
    assert.equal(await repository.exists(".claude/hooks/format.sh"), false);
  });
});

test("hand-editing a generated settings entry is reported, not overwritten", async () => {
  await withHooks(async (repository) => {
    repository.run("sync");

    const settings = JSON.parse(await repository.read(".claude/settings.json"));

    settings.hooks.PostToolUse[0].matcher = "Edit";
    await repository.write(".claude/settings.json", `${JSON.stringify(settings, null, 2)}\n`);

    const sync = repository.run("sync");

    assert.equal(sync.code, 1);
    assert.match(sync.stderr, /modified by hand/);
    assert.equal(
      JSON.parse(await repository.read(".claude/settings.json")).hooks.PostToolUse[0].matcher,
      "Edit",
      "the hand-edited entry is left exactly as the user wrote it"
    );
  });
});

test("unparseable settings stop the sync instead of being replaced", async () => {
  await withHooks(async (repository) => {
    await repository.write(".claude/settings.json", "{ not json\n");

    const sync = repository.run("sync");

    assert.equal(sync.code, 1);
    assert.match(sync.stderr, /not valid JSON/);
    assert.equal(await repository.read(".claude/settings.json"), "{ not json\n");
  });
});

test("hooks are idempotent across syncs", async () => {
  await withHooks(async (repository) => {
    repository.run("sync");

    const before = await repository.fingerprint();

    assert.equal(repository.run("sync").code, 0);
    assert.equal(await repository.fingerprint(), before);
    assert.equal(repository.run("check").code, 0);
  });
});

test("codex reports that it cannot express hooks", async () => {
  await withHooks(async (repository) => {
    const sync = repository.run("sync");

    assert.match(sync.stdout, /Codex has no repository hook format/);
  });
});
