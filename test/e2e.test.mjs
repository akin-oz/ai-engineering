import assert from "node:assert/strict";
import test from "node:test";

import { initializedRepository, makeRepository } from "./helpers.mjs";

const RULE = "Prefer small, reviewable changes.\n";

async function withRepository(run) {
  const repository = await initializedRepository();

  try {
    await run(repository);
  } finally {
    await repository.cleanup();
  }
}

test("init then sync produces instructions both runtimes load", async () => {
  await withRepository(async (repository) => {
    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const claude = await repository.read("CLAUDE.md");
    const agents = await repository.read("AGENTS.md");

    assert.match(claude, /Prefer small, reviewable changes/);
    assert.match(agents, /Prefer small, reviewable changes/);
    assert.match(claude, /DO NOT EDIT/);
    assert.doesNotMatch(claude, /\{\{/);
    assert.doesNotMatch(agents, /\{\{/);

    const ownership = JSON.parse(await repository.read(".ai/state/targets/claude.json"));

    assert.deepEqual(ownership.paths, ["CLAUDE.md"]);
  });
});

test("a second sync changes nothing", async () => {
  await withRepository(async (repository) => {
    repository.run("sync");

    const before = await repository.fingerprint();
    const second = repository.run("sync");

    assert.equal(second.code, 0, second.stderr);
    assert.equal(await repository.fingerprint(), before);
    assert.match(second.stdout, /unchanged CLAUDE\.md/);
  });
});

test("sync preserves files it did not generate", async () => {
  await withRepository(async (repository) => {
    await repository.write(".claude/settings.json", '{"permissions":{"allow":["Bash(npm test)"]}}');
    await repository.write(".claude/commands/mine.md", "my own command\n");

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);
    assert.equal(
      await repository.read(".claude/settings.json"),
      '{"permissions":{"allow":["Bash(npm test)"]}}'
    );
    assert.equal(await repository.read(".claude/commands/mine.md"), "my own command\n");
  });
});

test("sync refuses to overwrite an unowned file and writes nothing", async () => {
  await withRepository(async (repository) => {
    await repository.write("CLAUDE.md", "hand written\n");

    const before = await repository.fingerprint();
    const sync = repository.run("sync");

    assert.equal(sync.code, 1);
    assert.match(sync.stderr, /Refusing to overwrite/);
    assert.match(sync.stderr, /CLAUDE\.md/);
    assert.equal(await repository.fingerprint(), before, "the working tree must be untouched");

    const forced = repository.run("sync", "--force");

    assert.equal(forced.code, 0, forced.stderr);
    assert.match(await repository.read("CLAUDE.md"), /DO NOT EDIT/);

    const again = repository.run("sync");

    assert.equal(again.code, 0, again.stderr);
  });
});

test("an unowned file that already matches the plan is adopted silently", async () => {
  await withRepository(async (repository) => {
    repository.run("sync");

    const generated = await repository.read("CLAUDE.md");
    const fresh = await makeRepository();

    try {
      fresh.run("init");
      await fresh.write("CLAUDE.md", generated);

      const sync = fresh.run("sync");

      assert.equal(sync.code, 0, sync.stderr);
      assert.match(sync.stdout, /unchanged CLAUDE\.md/);
    } finally {
      await fresh.cleanup();
    }
  });
});

test("removing a source removes its artifacts and prunes empty directories", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/agents/reviewer.md", "You review code.\n");
    await repository.write(".ai/manifest.yaml", manifest({ agents: ["reviewer"], rules: ["project"] }));
    repository.run("sync");

    assert.equal(await repository.exists(".claude/agents/reviewer.md"), true);

    await repository.write(".ai/manifest.yaml", manifest({ agents: [], rules: ["project"] }));
    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);
    assert.equal(await repository.exists(".claude/agents/reviewer.md"), false);
    assert.equal(await repository.exists(".claude/agents"), false, "empty directories are pruned");
    assert.equal(await repository.exists("CLAUDE.md"), true);
  });
});

test("every runtime compiles the same set of sources", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/agents/reviewer.md", "You review code.\n");
    await repository.write(".ai/agents/ignored.md", "Not listed anywhere.\n");
    await repository.write(".ai/rules/testing.md", "Run the suite.\n");
    await repository.write(
      ".ai/manifest.yaml",
      manifest({ agents: ["reviewer"], rules: ["project", "testing"] })
    );

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const agents = await repository.read("AGENTS.md");
    const claude = await repository.read("CLAUDE.md");

    assert.match(agents, /## Agent: reviewer/);
    assert.doesNotMatch(agents, /ignored/);
    assert.equal(await repository.exists(".claude/agents/reviewer.md"), true);
    assert.equal(await repository.exists(".claude/agents/ignored.md"), false);

    for (const rule of ["project", "testing"]) {
      assert.match(agents, new RegExp(`## Rule: ${rule}`));
      assert.match(claude, new RegExp(`## Rule: ${rule}`));
    }

    assert.match(sync.stdout, /"ignored" is not listed in manifest agents/);
  });
});

test("an empty agents list leaves no dangling separator", async () => {
  await withRepository(async (repository) => {
    repository.run("sync");

    const agents = await repository.read("AGENTS.md");

    assert.doesNotMatch(agents, /## Agent:/);
    assert.doesNotMatch(agents, /\n---\s*$/);
  });
});

test("check reports drift without writing, and agrees with sync", async () => {
  await withRepository(async (repository) => {
    repository.run("sync");
    await repository.write(".ai/rules/project.md", "A completely new rule.\n");

    const before = await repository.fingerprint();
    const drifted = repository.run("check");

    assert.equal(drifted.code, 1);
    assert.match(drifted.stdout, /drift +CLAUDE\.md/);
    assert.equal(await repository.fingerprint(), before, "check must not write");

    repository.run("sync");

    const clean = repository.run("check");

    assert.equal(clean.code, 0, clean.stdout);
    assert.match(clean.stdout, /up to date/);
  });
});

test("check reports an unowned collision as a workspace error", async () => {
  await withRepository(async (repository) => {
    await repository.write("CLAUDE.md", "hand written\n");

    const result = repository.run("check");

    assert.equal(result.code, 2);
    assert.match(result.stderr, /Refusing to overwrite/);
  });
});

test("validate fails when a template would drop declared rules", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/templates/claude.md", "# Instructions\n\nNo placeholder here.\n");

    const result = repository.run("validate");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /\{\{RULES\}\}/);
  });
});

test("strict mode turns warnings into failures", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/rules/blank.md", "   \n");
    await repository.write(".ai/manifest.yaml", manifest({ agents: [], rules: ["project", "blank"] }));

    const lenient = repository.run("validate");
    const strict = repository.run("validate", "--strict");

    assert.equal(lenient.code, 0, lenient.stderr);
    assert.equal(strict.code, 1);
    assert.match(strict.stderr, /empty/);
  });
});

test("a hook script nobody declared is reported, not copied", async () => {
  await withRepository(async (repository) => {
    await repository.write(".ai/hooks/format.sh", "#!/bin/sh\n");

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);
    assert.match(sync.stdout, /not referenced by any hook/);
    assert.equal(await repository.exists(".claude/hooks/format.sh"), false);
  });
});

test("json output is stable and machine readable", async () => {
  await withRepository(async (repository) => {
    const sync = repository.run("sync", "--json");
    const payload = JSON.parse(sync.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.command, "sync");
    assert.ok(payload.targets.some((target) => target.id === "claude"));

    const artifact = payload.targets
      .flatMap((target) => target.artifacts)
      .find((entry) => entry.path === "CLAUDE.md");

    assert.deepEqual(artifact, { path: "CLAUDE.md", action: "created", kind: "artifact" });
    assert.ok(Array.isArray(payload.diagnostics));
  });
});

test("a 0.1 workspace migrates without losing hand-written files", async () => {
  const repository = await makeRepository();

  try {
    await repository.write(".ai/manifest.yaml", manifest({ agents: [], rules: ["engineering"] }));
    await repository.write(".ai/rules/engineering.md", RULE);
    await repository.write(".ai/templates/codex-agents.md", "{{RULES}}\n\n---\n\n{{AGENTS}}\n");
    await repository.write(".claude/rules/engineering.md", RULE);
    await repository.write(".claude/rules/mine.md", "hand written\n");
    await repository.write(
      ".codex/AGENTS.md",
      "<!--\n\nGenerated by @akinlabs/ai-engineering (codex)\n\nDO NOT EDIT.\n\n-->\nold\n"
    );

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);
    assert.equal(await repository.exists("AGENTS.md"), true);
    assert.equal(await repository.exists(".codex/AGENTS.md"), false, "generated output is replaced");
    assert.equal(
      await repository.exists(".claude/rules/engineering.md"),
      false,
      "a copy still matching its source is proven generated"
    );
    assert.equal(
      await repository.read(".claude/rules/mine.md"),
      "hand written\n",
      "a file the compiler cannot prove it wrote is preserved"
    );
    assert.match(sync.stdout, /deprecated/);
  } finally {
    await repository.cleanup();
  }
});

function manifest({ agents = [], rules = [], commands = [] } = {}) {
  const list = (name, values) => values.length
    ? `${name}:\n${values.map((value) => `  - ${value}`).join("\n")}\n`
    : `${name}: []\n`;

  return [
    "version: 1",
    "",
    "targets:",
    "  claude:",
    "    enabled: true",
    "  codex:",
    "    enabled: true",
    "",
    list("agents", agents),
    list("rules", rules),
    list("commands", commands),
  ].join("\n");
}
