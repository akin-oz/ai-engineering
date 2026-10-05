import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { makeRepository, projectRoot } from "./helpers.mjs";

const SETTINGS = ".claude/settings.json";

/** A configuration with every audited defense in place. */
const DEFENDED = {
  permissions: {
    deny: [
      "Read(.env)",
      "Read(./.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Bash(git commit --no-verify:*)",
      "Bash(git push --no-verify:*)",
    ],
  },
  sandbox: { enabled: true },
};

const SPEC_TRAILER_HOOK = {
  PreToolUse: [{
    matcher: "Bash",
    hooks: [{ type: "command", command: "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/spec-trailer.sh" }],
  }],
};

const OLD_HOOK = `#!/bin/sh
payload="$(cat)"
case "$payload" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
case "$payload" in
  *Spec:*) exit 0 ;;
esac
exit 2
`;

const BACKSTOP = `name: ci
on: pull_request
jobs:
  trailers:
    runs-on: ubuntu-latest
    steps:
      - run: git log --format='%H %(trailers:key=Spec,valueonly)' origin/main..HEAD
`;

async function withRepository(settings, run) {
  const repository = await makeRepository();

  try {
    if (settings !== undefined) {
      await repository.write(SETTINGS, typeof settings === "string" ? settings : `${JSON.stringify(settings, null, 2)}\n`);
    }

    await run(repository);
  } finally {
    await fs.chmod(repository.root, 0o755).catch(() => {});
    await repository.cleanup();
  }
}

function audit(repository, ...flags) {
  const result = repository.run("audit", "--json", ...flags);
  const payload = JSON.parse(result.stdout);

  return { ...result, payload, codes: (payload.findings ?? []).map((finding) => finding.code) };
}

function fires(code, result) {
  assert.ok(result.codes.includes(code), `${code} should fire: ${JSON.stringify(result.payload, null, 2)}`);
}

function quiet(code, result) {
  assert.ok(!result.codes.includes(code), `${code} should stay quiet: ${JSON.stringify(result.payload, null, 2)}`);
}

test("a defended repository has no findings and exits 0", async () => {
  await withRepository(DEFENDED, async (repository) => {
    const result = audit(repository, "--strict");

    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(result.payload.findings, []);
    assert.equal(result.payload.command, "audit");
  });
});

test("every finding has a stable code, severity, message, and fix", async () => {
  await withRepository(undefined, async (repository) => {
    await repository.write(".env", "SECRET=1\n");

    const { payload } = audit(repository);

    assert.ok(payload.findings.length >= 3);

    for (const finding of payload.findings) {
      assert.match(finding.code, /^[a-z]+(-[a-z]+)*$/);
      assert.ok(["error", "warning"].includes(finding.severity));
      assert.equal(typeof finding.message, "string");
      assert.equal(typeof finding.fix, "string");
    }
  });
});

test("deny-empty fires without deny rules, quiet with them", async () => {
  await withRepository({ sandbox: { enabled: true } }, async (repository) => {
    fires("deny-empty", audit(repository));
  });
  await withRepository({ permissions: { deny: [] } }, async (repository) => {
    fires("deny-empty", audit(repository));
  });
  await withRepository(DEFENDED, async (repository) => {
    quiet("deny-empty", audit(repository));
  });
});

test("sandbox-disabled fires unless the sandbox is enabled", async () => {
  await withRepository({ ...DEFENDED, sandbox: { enabled: false } }, async (repository) => {
    fires("sandbox-disabled", audit(repository));
  });
  await withRepository({ permissions: DEFENDED.permissions }, async (repository) => {
    fires("sandbox-disabled", audit(repository));
  });
  await withRepository(DEFENDED, async (repository) => {
    quiet("sandbox-disabled", audit(repository));
  });
});

test("mcp-auto-approve fires for enableAllProjectMcpServers, and is an error", async () => {
  await withRepository({ ...DEFENDED, enableAllProjectMcpServers: true }, async (repository) => {
    const result = audit(repository);

    fires("mcp-auto-approve", result);
    assert.equal(result.code, 1, "an error finding fails without --strict");
  });
  await withRepository({ ...DEFENDED, enableAllProjectMcpServers: false, enabledMcpjsonServers: ["docs"] }, async (repository) => {
    quiet("mcp-auto-approve", audit(repository));
  });
});

test("secret-readable fires for secrets no Read rule covers", async () => {
  await withRepository({ permissions: { deny: ["Read(./.env)"] }, sandbox: { enabled: true } }, async (repository) => {
    await repository.write(".env", "A=1\n");
    await repository.write("config/.env.production", "A=1\n");
    await repository.write("certs/server.pem", "x\n");
    await repository.write("deploy/id.key", "x\n");

    const result = audit(repository);
    const files = result.payload.findings
      .filter((finding) => finding.code === "secret-readable")
      .map((finding) => finding.file);

    assert.deepEqual(files, ["certs/server.pem", "config/.env.production", "deploy/id.key"]);
    assert.equal(result.code, 1);
  });
});

test("secret-readable stays quiet when rules cover the files, and for templates", async () => {
  await withRepository(DEFENDED, async (repository) => {
    await repository.write(".env", "A=1\n");
    await repository.write(".env.local", "A=1\n");
    await repository.write("certs/server.pem", "x\n");
    await repository.write("deploy/id.key", "x\n");
    await repository.write(".env.example", "A=\n");
    await repository.write("node_modules/pkg/test.key", "x\n");

    // A nested .env is covered by a bare-name rule at any depth.
    await repository.write("app/.env", "A=1\n");

    const result = audit(repository);

    quiet("secret-readable", result);
  });
});

test("secret-readable treats a bare Read and name-only rules as covering", async () => {
  await withRepository({ permissions: { deny: [".env", "Read(.env)", "Read(*.pem)"] }, sandbox: { enabled: true } }, async (repository) => {
    await repository.write("a/b/.env", "A=1\n");
    await repository.write("a/b/c.pem", "x\n");

    quiet("secret-readable", audit(repository));
  });
  await withRepository({ permissions: { deny: ["Read"] }, sandbox: { enabled: true } }, async (repository) => {
    await repository.write("deep/x.key", "x\n");

    quiet("secret-readable", audit(repository));
  });
});

test("secret-readable never reads a secret file", async () => {
  await withRepository(DEFENDED, async (repository) => {
    await repository.write(".env.production", "TOP=secret\n");
    await fs.chmod(path.join(repository.root, ".env.production"), 0o000);

    try {
      const result = audit(repository);

      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /TOP=secret/);
    } finally {
      await fs.chmod(path.join(repository.root, ".env.production"), 0o644);
    }
  });
});

test("no-verify-unblocked fires when git hooks exist and --no-verify is not denied", async () => {
  const settings = { permissions: { deny: ["Read(./.env)"] }, sandbox: { enabled: true } };

  for (const hookFile of [".husky/pre-commit", ".pre-commit-config.yaml", "lefthook.yml", ".githooks/pre-commit"]) {
    await withRepository(settings, async (repository) => {
      await repository.write(hookFile, "x\n");

      fires("no-verify-unblocked", audit(repository));
    });
  }
});

test("no-verify-unblocked fires for a real .git/hooks script", async () => {
  await withRepository({ permissions: { deny: ["Bash(git commit --no-verify:*)"] }, sandbox: { enabled: true } }, async (repository) => {
    execFileSync("git", ["init", "-q"], { cwd: repository.root });
    await repository.write(".git/hooks/pre-push", "#!/bin/sh\nexit 0\n");

    fires("no-verify-unblocked", audit(repository));
  });
});

test("no-verify-unblocked stays quiet without git hooks, or when both are denied", async () => {
  await withRepository({ permissions: { deny: ["Read(./.env)"] }, sandbox: { enabled: true } }, async (repository) => {
    execFileSync("git", ["init", "-q"], { cwd: repository.root });

    quiet("no-verify-unblocked", audit(repository));
  });
  await withRepository(DEFENDED, async (repository) => {
    await repository.write(".husky/pre-commit", "x\n");

    quiet("no-verify-unblocked", audit(repository));
  });
  await withRepository({ permissions: { deny: ["Bash(git * --no-verify*)"] }, sandbox: { enabled: true } }, async (repository) => {
    await repository.write(".husky/pre-commit", "x\n");

    quiet("no-verify-unblocked", audit(repository));
  });
});

test("hook-pattern-git-global-options fires for the 0.3.0 substring hook", async () => {
  await withRepository({ ...DEFENDED, hooks: SPEC_TRAILER_HOOK }, async (repository) => {
    await repository.write(".claude/hooks/spec-trailer.sh", OLD_HOOK);
    await repository.write(".github/workflows/ci.yml", BACKSTOP);

    const result = audit(repository);
    const finding = result.payload.findings.find((item) => item.code === "hook-pattern-git-global-options");

    assert.ok(finding, JSON.stringify(result.payload));
    assert.equal(finding.file, ".claude/hooks/spec-trailer.sh");
    assert.equal(result.code, 1);
  });
});

test("hook-pattern-git-global-options stays quiet for the shipped hook", async () => {
  const shipped = await fs.readFile(path.join(projectRoot, "packs/development/spec-driven/hooks/spec-trailer.sh"), "utf8");

  await withRepository({ ...DEFENDED, hooks: SPEC_TRAILER_HOOK }, async (repository) => {
    await repository.write(".claude/hooks/spec-trailer.sh", shipped);
    await repository.write(".github/workflows/ci.yml", BACKSTOP);

    const result = audit(repository, "--strict");

    quiet("hook-pattern-git-global-options", result);
    assert.equal(result.code, 0, result.stdout);
  });
});

test("hook-no-ci-backstop fires for the shipped guard without its CI check", async () => {
  await withRepository({ ...DEFENDED, hooks: SPEC_TRAILER_HOOK }, async (repository) => {
    await repository.write(".claude/hooks/spec-trailer.sh", "#!/bin/sh\nexit 0\n");
    await repository.write(".github/workflows/ci.yml", "name: ci\non: push\njobs: {}\n");

    fires("hook-no-ci-backstop", audit(repository));
  });
});

test("hook-no-ci-backstop stays quiet with the CI check, or without the guard", async () => {
  await withRepository({ ...DEFENDED, hooks: SPEC_TRAILER_HOOK }, async (repository) => {
    await repository.write(".claude/hooks/spec-trailer.sh", "#!/bin/sh\nexit 0\n");
    await repository.write(".github/workflows/trailers.yaml", BACKSTOP);

    quiet("hook-no-ci-backstop", audit(repository));
  });
  await withRepository(DEFENDED, async (repository) => {
    quiet("hook-no-ci-backstop", audit(repository));
  });
});

test("--strict turns a warning into exit 1", async () => {
  await withRepository({ permissions: DEFENDED.permissions }, async (repository) => {
    assert.equal(audit(repository).code, 0, "sandbox-disabled is a warning");
    assert.equal(audit(repository, "--strict").code, 1);
  });
});

test("an unparseable settings.json is a broken workspace, exit 2", async () => {
  await withRepository("{ not json", async (repository) => {
    const result = repository.run("audit");

    assert.equal(result.code, 2);
    assert.equal(repository.run("audit", "--json").code, 2);
  });
});

test("audit works without an .ai workspace and writes nothing", async () => {
  await withRepository(DEFENDED, async (repository) => {
    const before = await repository.fingerprint();

    audit(repository);

    assert.equal(await repository.fingerprint(), before);
    assert.equal(await repository.exists(".ai"), false);
  });
});

test("audit output is deterministic", async () => {
  await withRepository(undefined, async (repository) => {
    await repository.write(".env", "A=1\n");
    await repository.write("b.key", "x\n");
    await repository.write("a.pem", "x\n");

    const first = repository.run("audit", "--json");
    const second = repository.run("audit", "--json");

    assert.equal(first.stdout, second.stdout);
    assert.equal(first.code, second.code);
  });
});

test("human output names the code and the fix", async () => {
  await withRepository({ ...DEFENDED, enableAllProjectMcpServers: true }, async (repository) => {
    const result = repository.run("audit");

    assert.equal(result.code, 1);
    assert.match(result.stdout, /mcp-auto-approve/);
  });
});
