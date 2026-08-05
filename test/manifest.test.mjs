import assert from "node:assert/strict";
import test from "node:test";

import { DiagnosticError, createDiagnostics } from "../src/diagnostics.mjs";
import { loadManifest } from "../src/manifest/load.mjs";
import { makeWorkspace } from "./helpers.mjs";

test("loads an immutable manifest and preserves declared order", async () => {
  const workspace = await makeWorkspace({
    manifest: [
      "version: 1",
      "targets:",
      "  codex:",
      "    enabled: true",
      "agents:",
      "  - second",
      "  - first",
      "  - second",
      "rules:",
      "  - security",
      "",
    ].join("\n"),
    agents: {
      "first.md": "first",
      "second.md": "second",
    },
    rules: {
      "security.md": "security",
    },
  });

  try {
    const manifest = await loadManifest(workspace.root);

    assert.deepEqual(manifest.agents, ["second", "first"]);
    assert.deepEqual(manifest.sources.agents.map((entry) => entry.id), ["second", "first"]);
    assert.equal(manifest.sources.rules[0].content, "security");
    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(manifest.resolve.output("codex"), `${workspace.root}/.codex`);
    assert.equal(manifest.resolve.directory("codex"), ".codex");
  } finally {
    await workspace.cleanup();
  }
});

test("commands are an optional source kind", async () => {
  const workspace = await makeWorkspace({
    manifest: "version: 1\ntargets: {}\ncommands:\n  - review\n",
    commands: { "review.md": "Review the diff.\n" },
  });

  try {
    const manifest = await loadManifest(workspace.root);

    assert.deepEqual(manifest.commands, ["review"]);
    assert.equal(manifest.sources.commands[0].content, "Review the diff.\n");
  } finally {
    await workspace.cleanup();
  }
});

test("rejects unsafe target output paths", async () => {
  const workspace = await makeWorkspace({
    manifest: [
      "version: 1",
      "targets:",
      "  codex:",
      "    output: ../outside",
      "",
    ].join("\n"),
  });

  try {
    await assert.rejects(
      loadManifest(workspace.root),
      (error) => error instanceof DiagnosticError && /relative path|inside/.test(error.message)
    );
  } finally {
    await workspace.cleanup();
  }
});

test("reports every missing source in one pass", async () => {
  const workspace = await makeWorkspace({
    manifest: "version: 1\nagents:\n  - missing\nrules:\n  - absent\n",
  });

  try {
    await assert.rejects(
      loadManifest(workspace.root),
      (error) => error instanceof DiagnosticError
        && error.message.includes("Unknown agent")
        && error.message.includes("Unknown rule")
    );
  } finally {
    await workspace.cleanup();
  }
});

test("warns about empty and unlisted sources without failing", async () => {
  const workspace = await makeWorkspace({
    manifest: "version: 1\ntargets: {}\nrules:\n  - blank\n",
    rules: { "blank.md": "  \n", "orphan.md": "not listed" },
  });

  try {
    const diagnostics = createDiagnostics();

    await loadManifest(workspace.root, { diagnostics });

    const codes = diagnostics.entries.map((entry) => entry.code).sort();

    assert.deepEqual(codes, ["source-empty", "source-unlisted"]);
    assert.equal(diagnostics.has("error"), false);
  } finally {
    await workspace.cleanup();
  }
});

test("warns about hook scripts no declared hook uses", async () => {
  const workspace = await makeWorkspace({ manifest: "version: 1\ntargets: {}\n" });

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    await fs.mkdir(path.join(workspace.ai, "hooks"), { recursive: true });
    await fs.writeFile(path.join(workspace.ai, "hooks", "format.sh"), "#!/bin/sh\n");

    const diagnostics = createDiagnostics();

    await loadManifest(workspace.root, { diagnostics });

    assert.equal(diagnostics.entries[0].code, "hook-script-unused");
  } finally {
    await workspace.cleanup();
  }
});

test("loads declared hooks and rejects unknown events", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const workspace = await makeWorkspace({
    manifest: "version: 1\ntargets: {}\nhooks:\n  - id: format\n    event: post-edit\n    run: hooks/format.sh\n",
  });

  try {
    await fs.mkdir(path.join(workspace.ai, "hooks"), { recursive: true });
    await fs.writeFile(path.join(workspace.ai, "hooks", "format.sh"), "#!/bin/sh\n");
    await fs.chmod(path.join(workspace.ai, "hooks", "format.sh"), 0o755);

    const manifest = await loadManifest(workspace.root);

    assert.equal(manifest.sources.hooks.length, 1);
    assert.equal(manifest.sources.hooks[0].event, "post-edit");
    assert.equal(manifest.sources.hooks[0].mode, 0o755);

    await fs.writeFile(
      path.join(workspace.ai, "manifest.yaml"),
      "version: 1\ntargets: {}\nhooks:\n  - id: format\n    event: on-tuesday\n    run: hooks/format.sh\n"
    );

    await assert.rejects(
      loadManifest(workspace.root),
      (error) => /unknown event "on-tuesday"/.test(error.message)
    );
  } finally {
    await workspace.cleanup();
  }
});

test("rejects a hook script outside the workspace", async () => {
  const workspace = await makeWorkspace({
    manifest: "version: 1\ntargets: {}\nhooks:\n  - id: escape\n    event: post-edit\n    run: ../../etc/passwd\n",
  });

  try {
    await assert.rejects(
      loadManifest(workspace.root),
      (error) => /must live inside \.ai/.test(error.message)
    );
  } finally {
    await workspace.cleanup();
  }
});

test("rule frontmatter becomes metadata and unknown keys warn", async () => {
  const workspace = await makeWorkspace({
    manifest: "version: 1\ntargets: {}\nrules:\n  - scoped\n",
    rules: {
      "scoped.md": "---\ndescription: Scoped rule\nscope: src/**/*.ts\nnonsense: true\n---\n\nBody text.\n",
    },
  });

  try {
    const diagnostics = createDiagnostics();
    const manifest = await loadManifest(workspace.root, { diagnostics });
    const rule = manifest.sources.rules[0];

    assert.equal(rule.metadata.description, "Scoped rule");
    assert.equal(rule.metadata.scope, "src/**/*.ts");
    assert.equal(rule.body.trim(), "Body text.");
    assert.match(rule.content, /^---/, "the full file is preserved for verbatim runtimes");
    assert.equal(diagnostics.entries[0].code, "metadata-unknown-key");
  } finally {
    await workspace.cleanup();
  }
});
