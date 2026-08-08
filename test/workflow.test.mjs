import assert from "node:assert/strict";
import test from "node:test";

import { makeRepository } from "./helpers.mjs";

const BLUEPRINT = `schema: 2

project:
  type: library

workflow:
  development: spec-driven

ai:
  runtimes: [claude, codex]
`;

async function withBlueprint(run) {
  const repository = await makeRepository();

  try {
    await repository.write(".ai/blueprint.yaml", BLUEPRINT);
    await run(repository);
  } finally {
    await repository.cleanup();
  }
}

test("a blueprint composes a workflow into generated sources and runtime files", async () => {
  await withBlueprint(async (repository) => {
    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    for (const file of [
      ".ai/generated/rules/spec-first.md",
      ".ai/generated/agents/spec-author.md",
      ".ai/generated/commands/spec.md",
      ".ai/generated/templates/spec.md",
      ".claude/agents/spec-author.md",
      ".claude/commands/spec.md",
      "CLAUDE.md",
      "AGENTS.md",
    ]) {
      assert.equal(await repository.exists(file), true, `expected ${file}`);
    }

    assert.match(await repository.read("CLAUDE.md"), /## Rule: spec-first/);
    assert.match(await repository.read("AGENTS.md"), /## Agent: spec-author/);
  });
});

test("generated sources record where they came from without breaking frontmatter", async () => {
  await withBlueprint(async (repository) => {
    repository.run("sync");

    const agent = await repository.read(".ai/generated/agents/spec-author.md");

    assert.match(agent, /^---\n/, "frontmatter still starts the file");
    assert.match(agent, /generated-by: development\/spec-driven@\d+/);
    assert.ok(
      agent.indexOf("generated-by") > agent.indexOf("---"),
      "provenance sits after the frontmatter block"
    );
  });
});

test("blueprint compilation is deterministic", async () => {
  await withBlueprint(async (repository) => {
    repository.run("sync");

    const before = await repository.fingerprint();

    assert.equal(repository.run("sync").code, 0);
    assert.equal(await repository.fingerprint(), before);
    assert.equal(repository.run("check").code, 0);
  });
});

test("local sources compile alongside the pack", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/rules/house-style.md", "Two spaces, no tabs.\n");

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const claude = await repository.read("CLAUDE.md");

    assert.match(claude, /## Rule: spec-first/);
    assert.match(claude, /## Rule: house-style/);
  });
});

test("a local file cannot silently replace a pack contribution", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/rules/spec-first.md", "Something else entirely.\n");

    const sync = repository.run("sync");

    assert.equal(sync.code, 1);
    assert.match(sync.stderr, /contributed by the workflow pack/);
  });
});

test("a blueprint and a manifest together is an error, not a guess", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/manifest.yaml", "version: 1\ntargets: {}\n");

    const sync = repository.run("sync");

    assert.equal(sync.code, 1);
    assert.match(sync.stderr, /Keep one/);
  });
});

test("unknown blueprint fields and workflows are rejected", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/blueprint.yaml", `${BLUEPRINT}\nnonsense: true\n`);
    assert.match(repository.run("validate").stderr, /Unknown blueprint field "nonsense"/);

    await repository.write(".ai/blueprint.yaml", BLUEPRINT.replace("spec-driven", "vibes"));
    assert.match(repository.run("validate").stderr, /Unknown workflow "vibes"/);
  });
});

test("explain reports what the workflow contributed and where it lands", async () => {
  await withBlueprint(async (repository) => {
    repository.run("sync");

    const explain = repository.run("explain");

    assert.equal(explain.code, 0, explain.stderr);
    assert.match(explain.stdout, /workflow: spec-driven \(development\/spec-driven@\d+\)/);
    assert.match(explain.stdout, /project: +library/);
    assert.match(explain.stdout, /spec-author\s+→ claude, codex/);
    assert.match(explain.stdout, /command\s+spec\s+→ claude, codex: unsupported/);
    assert.match(
      explain.stdout,
      /template spec\s+→ read from .*generated\/templates\/spec\.md/,
      "a template is not compiled for a runtime, so explain gives its path"
    );
  });
});

test("a blueprint can declare hooks, including the pack's own", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/hooks/verify.sh", "#!/bin/sh\nexit 0\n");
    await repository.write(".ai/blueprint.yaml", `${BLUEPRINT}
hooks:
  - id: verify-on-stop
    event: turn-end
    run: hooks/verify.sh
`);

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);

    const settings = JSON.parse(await repository.read(".claude/settings.json"));

    assert.equal(settings.hooks.Stop.length, 1, "turn-end compiles to Claude's Stop event");
    assert.match(settings.hooks.Stop[0].hooks[0].command, /verify\.sh$/);

    // The pack ships its own hook, which must land alongside the local one.
    assert.equal(settings.hooks.PreToolUse[0].matcher, "Bash");
    assert.equal(await repository.exists(".claude/hooks/spec-trailer.sh"), true);
    assert.equal(await repository.exists(".ai/generated/hooks/spec-trailer.sh"), true);
  });
});

test("a pack hook script is materialized executable", async () => {
  await withBlueprint(async (repository) => {
    repository.run("sync");

    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const mode = (await fs.stat(path.join(repository.root, ".claude/hooks/spec-trailer.sh"))).mode;

    assert.ok(mode & 0o111, "a hook the runtime executes must arrive executable");
  });
});

test("a single pack contribution can be disabled", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/blueprint.yaml", BLUEPRINT.replace(
      "  development: spec-driven",
      "  development: spec-driven\n  disable: [hook.spec-trailer, rule.change-boundary]"
    ));

    const sync = repository.run("sync");

    assert.equal(sync.code, 0, sync.stderr);
    assert.equal(
      await repository.exists(".claude/settings.json"),
      false,
      "with its only hook disabled the pack must not touch settings.json"
    );
    assert.equal(await repository.exists(".ai/generated/hooks/spec-trailer.sh"), false);
    assert.equal(await repository.exists(".ai/generated/rules/change-boundary.md"), false);
    assert.equal(await repository.exists(".ai/generated/rules/spec-first.md"), true);
    assert.doesNotMatch(await repository.read("CLAUDE.md"), /## Rule: change-boundary/);
  });
});

test("disabling something the pack does not contribute is an error", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/blueprint.yaml", BLUEPRINT.replace(
      "  development: spec-driven",
      "  development: spec-driven\n  disable: [rule.typo]"
    ));

    const result = repository.run("validate");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not contribute it/);
    assert.match(result.stderr, /rule\.spec-first/, "the error lists what is available");
  });
});

test("a blueprint hook cannot silently replace a pack hook", async () => {
  await withBlueprint(async (repository) => {
    await repository.write(".ai/hooks/mine.sh", "#!/bin/sh\nexit 0\n");
    await repository.write(".ai/blueprint.yaml", `${BLUEPRINT}
hooks:
  - id: spec-trailer
    event: turn-end
    run: hooks/mine.sh
`);

    const sync = repository.run("sync");

    assert.equal(sync.code, 1);
    assert.match(sync.stderr, /Duplicate hook id "spec-trailer"/);
  });
});

test("explain says so when nothing composes the workspace", async () => {
  const repository = await makeRepository();

  try {
    repository.run("init");

    const explain = repository.run("explain");

    assert.equal(explain.code, 0, explain.stderr);
    assert.match(explain.stdout, /lists its sources by hand/);
  } finally {
    await repository.cleanup();
  }
});

test("init --blueprint refuses to mix workspace styles", async () => {
  const repository = await makeRepository();

  try {
    repository.run("init");

    const blueprint = repository.run("init", "--blueprint");

    assert.equal(blueprint.code, 1);
    assert.match(blueprint.stderr, /not both/);
  } finally {
    await repository.cleanup();
  }
});
