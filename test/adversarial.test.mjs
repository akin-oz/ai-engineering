import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { projectRoot } from "./helpers.mjs";

/**
 * Attempts to commit past the spec-driven pack's `Spec:` trailer guard, run
 * against the real script with the payload Claude Code sends a PreToolUse hook.
 * Exit 2 blocks the tool call; exit 0 allows it.
 *
 * Every row names what it exercises, so a failure reads as "this bypass is
 * open again" rather than as a line number.
 */

const SCRIPT = path.join(projectRoot, "packs/development/spec-driven/hooks/spec-trailer.sh");
const BLOCK = 2;
const ALLOW = 0;

const heredoc = (body, delimiter = "'EOF'") =>
  `git commit -m "$(cat <<${delimiter}\n${body}\nEOF\n)"`;

const ATTEMPTS = [
  // Honest commits must keep working, or the hook gets disabled.
  ["two -m paragraphs with a trailer", "git commit -m \"Add x\" -m \"Spec: 015\"", ALLOW],
  ["here-document message, the form agents use", heredoc("Add x\n\nSpec: 015"), ALLOW],
  ["here-document with a none trailer", heredoc("Refactor x\n\nSpec: none — refactor, no behavior change"), ALLOW],
  ["here-document on stdin with -F -", "git commit -F - <<'EOF'\nAdd x\n\nSpec: 015\nEOF", ALLOW],
  ["ANSI-C quoted message", "git commit -m $'Add x\\n\\nSpec: 015'", ALLOW],
  ["--trailer option", "git commit --trailer \"Spec: 015\" -m \"Add x\"", ALLOW],
  ["--trailer with = separator", "git commit -m \"Add x\" --trailer=Spec=015", ALLOW],
  ["trailer among other trailers", heredoc("Add x\n\nSpec: 015\nSigned-off-by: A <a@example.com>"), ALLOW],
  ["-am cluster with a trailer", "git commit -am \"Add x\" -m \"Spec: 015\"", ALLOW],
  ["chained after add, with a trailer", "git add -A && git commit -m \"Add x\" -m \"Spec: 015\"", ALLOW],
  ["global options, with a trailer", "git -C . -c user.name=x commit -m \"Add x\" -m \"Spec: 015\"", ALLOW],
  ["not a commit", "git status", ALLOW],
  ["not git", "npm test", ALLOW],
  ["the word commit as a git log argument", "git log --grep commit", ALLOW],
  ["commit mentioned in a quoted string", "grep -rn \"git commit\" docs", ALLOW],
  ["amend reusing the message", "git commit --amend --no-edit", ALLOW],
  ["amend alone", "git commit --amend", ALLOW],
  ["fixup commit", "git commit --fixup HEAD", ALLOW],

  ["plain message without a trailer", "git commit -m \"Add x\"", BLOCK],
  ["no message, so an editor would open", "git commit", BLOCK],

  // Bypass 1: the commit is not recognized as a commit.
  ["bypass 1: git -C dir commit", "git -C sub commit -m \"Add x\"", BLOCK],
  ["bypass 1: git -c key=value commit", "git -c user.name=x commit -m \"Add x\"", BLOCK],
  ["bypass 1: absolute path to git", "/usr/bin/git commit -m \"Add x\"", BLOCK],
  ["bypass 1: two spaces", "git  commit -m \"Add x\"", BLOCK],
  ["bypass 1: tab", "git\tcommit -m \"Add x\"", BLOCK],
  ["bypass 1: --git-dir and --work-tree", "git --git-dir=.git --work-tree . commit -m \"Add x\"", BLOCK],
  ["bypass 1: --no-pager", "git --no-pager commit -m \"Add x\"", BLOCK],
  ["bypass 1: quoted command name", "g\"i\"t commit -m \"Add x\"", BLOCK],
  ["bypass 1: escaped command name", "\\git commit -m \"Add x\"", BLOCK],
  ["bypass 1: env wrapper", "env GIT_AUTHOR_NAME=x git commit -m \"Add x\"", BLOCK],
  ["bypass 1: assignment prefix", "GIT_AUTHOR_NAME=x git commit -m \"Add x\"", BLOCK],
  ["bypass 1: after cd", "cd sub && git commit -m \"Add x\"", BLOCK],
  ["bypass 1: subshell", "(git commit -m \"Add x\")", BLOCK],
  ["bypass 1: inside an if", "if true; then git commit -m \"Add x\"; fi", BLOCK],
  ["bypass 1: command substitution", "echo $(git commit -m \"Add x\")", BLOCK],
  ["bypass 1: backticks", "echo `git commit -m \"Add x\"`", BLOCK],
  ["bypass 1: sh -c", "sh -c 'git commit -m \"Add x\"'", BLOCK],
  ["bypass 1: bash -lc with global options", "bash -lc \"git -C . commit -m 'Add x'\"", BLOCK],
  ["bypass 1: eval", "eval \"git commit -m 'Add x'\"", BLOCK],
  ["bypass 1: xargs", "echo x | xargs git commit -m", BLOCK],
  ["bypass 1: git in a variable", "$GIT commit -m \"Add x\"", BLOCK],
  ["bypass 1: subcommand in a variable", "git $SUB -m \"Add x\"", BLOCK],
  ["bypass 1: python os.system", "python3 -c \"import os; os.system('git commit -m x')\"", BLOCK],
  ["bypass 1: node child_process", "node -e \"require('child_process').execSync('git commit -m x')\"", BLOCK],

  // Bypass 2: an option name inside the message disables the guard.
  ["bypass 2: --amend in the message", "git commit -m \"Handle --amend correctly\"", BLOCK],
  ["bypass 2: --no-edit in the message", "git commit -m \"Respect --no-edit\"", BLOCK],
  ["bypass 2: amend with a new message", "git commit --amend -m \"Reword\"", BLOCK],

  // Bypass 3: "Spec:" somewhere that is not a trailer.
  ["bypass 3: Spec: in the subject", "git commit -m \"Spec: 015 add x\"", BLOCK],
  ["bypass 3: Spec: in a shell comment", "git commit -m \"Add x\" # Spec: 015", BLOCK],
  ["bypass 3: Spec: in prose", "git commit -m $'Add x\\n\\nThis implements Spec: 015 in prose.'", BLOCK],
  ["bypass 3: prose after the trailer", heredoc("Add x\n\nSpec: 015\n\nMore prose."), BLOCK],
  ["bypass 3: empty trailer", "git commit -m \"Add x\" -m \"Spec:\"", BLOCK],
  ["bypass 3: literal backslash-n in double quotes", "git commit -m \"Add x\\n\\nSpec: 015\"", BLOCK],
  ["bypass 3: Spec: in another command", "echo \"Spec: 015\" && git commit -m \"Add x\"", BLOCK],
  ["bypass 3: Spec: as a pathspec", "git commit -m \"Add x\" -- Spec:", BLOCK],
  ["bypass 3: Spec: as a --trailer key prefix", "git commit -m \"Add x\" --trailer \"Specs: 015\"", BLOCK],

  // A message the hook cannot read without running something.
  ["unreadable: message in a variable", "git commit -m \"$MSG\"", BLOCK],
  ["unreadable: message from a program", "git commit -m \"$(./make-message)\"", BLOCK],
  ["unreadable: unquoted here-document with expansion", heredoc("Add $X\n\nSpec: 015", "EOF"), BLOCK],
  ["unreadable: message piped in", "printf 'Add x\\n\\nSpec: 015\\n' | git commit -F -", BLOCK],
  ["unreadable: message file does not exist", "git commit -F missing.txt", BLOCK],
  ["unreadable: nesting too deep to analyze", `${"$(".repeat(5000)}git commit -m x${")".repeat(5000)}`, BLOCK],
];

let repository;

before(async () => {
  repository = await fs.mkdtemp(path.join(os.tmpdir(), "ai-engineering-adversarial-"));

  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
  };

  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty",
    "-m", "Without a trailer");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty",
    "-m", "With a trailer", "-m", "Spec: 015");
  await fs.writeFile(path.join(repository, "good.txt"), "Add x\n\nSpec: 015\n");
  await fs.writeFile(path.join(repository, "bad.txt"), "Add x\n\nMentions Spec: 015 in prose.\n");
  await fs.mkdir(path.join(repository, "sub"));
  await fs.writeFile(path.join(repository, "sub", "good.txt"), "Add x\n\nSpec: 015\n");
});

after(async () => {
  await fs.rm(repository, { recursive: true, force: true });
});

function payload(command, cwd = repository) {
  return JSON.stringify({
    session_id: "test",
    transcript_path: "/dev/null",
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "test" },
  });
}

function runHook(input, { env = process.env } = {}) {
  const result = spawnSync("/bin/sh", [SCRIPT], { input, env, encoding: "utf8", cwd: repository });

  return { code: result.status, stderr: result.stderr };
}

describe("spec-trailer hook against adversarial commands", () => {
  for (const [name, command, expected] of ATTEMPTS) {
    test(name, () => {
      const result = runHook(payload(command));

      assert.equal(
        result.code,
        expected,
        `${expected === BLOCK ? "expected a block" : "expected to allow"}: ${JSON.stringify(command)}\n${result.stderr}`
      );
    });
  }
});

describe("spec-trailer hook with message files and reused messages", () => {
  const cases = [
    ["-F file with a trailer", "git commit -F good.txt", ALLOW],
    ["-F file with Spec: only in prose", "git commit -F bad.txt", BLOCK],
    ["--file= resolved against git -C", "git -C sub commit --file=good.txt", ALLOW],
    ["-C reusing a message with a trailer", "git commit -C HEAD", ALLOW],
    ["-C reusing a message without one", "git commit -C HEAD~1", BLOCK],
    ["--reuse-message= without one", "git commit --reuse-message=HEAD~1", BLOCK],
  ];

  for (const [name, command, expected] of cases) {
    test(name, () => {
      const result = runHook(payload(command));

      assert.equal(result.code, expected, `${JSON.stringify(command)}\n${result.stderr}`);
    });
  }
});

describe("spec-trailer hook fails open when it breaks", () => {
  test("node is not on PATH", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "ai-engineering-nopath-"));

    try {
      const result = runHook(payload("git commit -m \"Add x\""), { env: { PATH: empty } });

      assert.equal(result.code, ALLOW, result.stderr);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  test("git is not on PATH, so trailers cannot be parsed", async () => {
    const onlyNode = await fs.mkdtemp(path.join(os.tmpdir(), "ai-engineering-onlynode-"));

    try {
      await fs.symlink(process.execPath, path.join(onlyNode, "node"));

      const result = runHook(payload("git commit -m \"Add x\""), { env: { PATH: onlyNode } });

      assert.equal(result.code, ALLOW, result.stderr);
    } finally {
      await fs.rm(onlyNode, { recursive: true, force: true });
    }
  });

  test("the payload is not JSON", () => {
    assert.equal(runHook("git commit -m x").code, ALLOW);
  });

  test("the payload is empty", () => {
    assert.equal(runHook("").code, ALLOW);
  });

  test("the payload has no command", () => {
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: {} })).code, ALLOW);
  });

  test("a block explains how to fix the commit", () => {
    const result = runHook(payload("git commit -m \"Add x\""));

    assert.equal(result.code, BLOCK);
    assert.match(result.stderr, /Spec: 004/);
  });
});
