import path from "node:path";

import { SETTINGS } from "./snapshot.mjs";

/**
 * Audit rules for Claude Code's committed project configuration. Each rule is a
 * pure function of the snapshot and returns findings with a stable code, a
 * severity, and a fix. Rule semantics follow code.claude.com/docs/en/permissions
 * and /sandboxing; where a rule form cannot be interpreted with confidence the
 * rule reports rather than clears, so the worst case is a false finding with a
 * fix, never a false all-clear.
 */
export const rules = [
  denyEmpty,
  sandboxDisabled,
  mcpAutoApprove,
  secretReadable,
  noVerifyUnblocked,
  hookPatternGitGlobalOptions,
  hookNoCiBackstop,
];

const TEMPLATE_SUFFIXES = /\.(example|sample|template|dist)$/;

const NO_VERIFY_COMMANDS = ["git commit --no-verify -m message", "git push --no-verify"];

const GIT_HOOK_MARKERS = [/^\.husky\//, /^\.githooks\//, /^\.pre-commit-config\.ya?ml$/, /^lefthook\.ya?ml$/, /^\.lefthook\.ya?ml$/];

/** Guards this compiler ships, and the CI check that backs each one up. */
const KNOWN_GUARDS = [
  {
    script: "spec-trailer.sh",
    backstop: /trailers:key=Spec/,
    fix: "Add the CI check from the spec-trailer rule (.ai/generated/rules/spec-trailer.md) to a workflow, so a commit that gets past the hook still fails the pull request.",
  },
];

/** Substring matches on git commands: `*"git commit"*`, `grep 'git push'`, `=~ git\ commit`. */
const SUBSTRING_GIT_PATTERN = [
  /\*\s*["']?git\s+(commit|push)\b[^*\n]*["']?\s*\*/,
  /\bgrep\b[^\n|;]*["']git(\s|\\s|\[\[:space:\]\])+[+*]?(commit|push)/,
  /=~\s*["']?git(\\?\s|\\s)+[+*]?(commit|push)/,
];

export function auditClaude(snapshot) {
  return rules.flatMap((rule) => rule(snapshot)).sort(byCodeThenFile);
}

function denyEmpty({ settings }) {
  if (denyRules(settings).length) {
    return [];
  }

  return [finding("deny-empty", "warning", {
    message: "permissions.deny is empty, so the model is only ever asked, never refused.",
    file: settings ? SETTINGS : undefined,
    fix: 'Declare deny rules, starting with secrets: "Read(./.env)", "Read(./.env.*)", "Read(**/*.pem)", "Read(**/*.key)".',
  })];
}

function sandboxDisabled({ settings }) {
  if (settings?.sandbox?.enabled === true) {
    return [];
  }

  return [finding("sandbox-disabled", "warning", {
    message: "The Bash sandbox is not enabled. Edit and Read rules stop Claude's file tools, not shell commands such as sed -i, cp, or curl.",
    file: settings ? SETTINGS : undefined,
    fix: 'Set "sandbox": { "enabled": true } and restrict filesystem and network access from there.',
  })];
}

function mcpAutoApprove({ settings }) {
  if (settings?.enableAllProjectMcpServers !== true) {
    return [];
  }

  return [finding("mcp-auto-approve", "error", {
    message: "enableAllProjectMcpServers is true, so any MCP server added to .mcp.json runs without approval, outside the sandbox.",
    file: SETTINGS,
    fix: "Remove enableAllProjectMcpServers and list the servers you trust in enabledMcpjsonServers.",
  })];
}

function secretReadable({ settings, files }) {
  const deny = denyRules(settings);

  return files
    .filter(isSecretName)
    .filter((file) => !readDenied(deny, file))
    .map((file) => finding("secret-readable", "error", {
      message: `${file} looks like a secret and no Read deny rule covers it.`,
      file,
      fix: `Add "Read(./${file})" to permissions.deny, or a pattern that covers it.`,
    }));
}

function noVerifyUnblocked({ settings, files, gitHooks }) {
  const hooked = gitHooks.length || files.some((file) => GIT_HOOK_MARKERS.some((pattern) => pattern.test(file)));

  if (!hooked) {
    return [];
  }

  const deny = denyRules(settings);
  const unblocked = NO_VERIFY_COMMANDS.filter((command) => !deny.some((rule) => bashMatches(rule, command)));

  if (!unblocked.length) {
    return [];
  }

  return [finding("no-verify-unblocked", "warning", {
    message: `This repository has git hooks, and nothing denies skipping them: ${unblocked.map((item) => `"${item}"`).join(", ")} would be allowed.`,
    file: settings ? SETTINGS : undefined,
    fix: 'Deny "Bash(git commit --no-verify:*)" and "Bash(git push --no-verify:*)". String rules miss "git commit -n" and "git -c core.hooksPath=… commit", so re-run the hooks\' checks in CI.',
  })];
}

function hookPatternGitGlobalOptions({ hookScripts }) {
  return hookScripts
    .filter(({ contents }) => SUBSTRING_GIT_PATTERN.some((pattern) => pattern.test(stripComments(contents))))
    .map(({ file }) => finding("hook-pattern-git-global-options", "error", {
      message: `${file} matches git commands as a substring, so "git -C dir commit", "git -c key=value commit", and "git  commit" pass unchecked.`,
      file,
      fix: "Parse the command instead of matching it: skip git's global options (-C, -c, --git-dir, --work-tree) before reading the subcommand. The spec-driven pack's spec-trailer.sh does this.",
    }));
}

function hookNoCiBackstop({ settings, workflows }) {
  const commands = hookCommands(settings);

  return KNOWN_GUARDS
    .filter((guard) => commands.some((command) => path.posix.basename(command.replace(/["']/g, "").split(/\s/)[0]) === guard.script))
    .filter((guard) => !workflows.some(({ contents }) => guard.backstop.test(contents)))
    .map((guard) => finding("hook-no-ci-backstop", "warning", {
      message: `${SETTINGS} runs ${guard.script}, which fails open when it breaks and can be talked around, and no workflow under .github/workflows/ re-checks what it guards.`,
      file: SETTINGS,
      fix: guard.fix,
    }));
}

/**
 * Matches a Read deny rule against a repository-relative path. Gitignore-style:
 * a bare name matches at any depth, `./` anchors at the root, a `!` rule carves
 * out of earlier ones. Rules anchored outside the repository never cover.
 */
export function readDenied(rules, file) {
  let covered = false;

  for (const rule of rules) {
    if (rule === "Read" || rule === "Read(*)" || rule === "Read(**)") {
      covered = true;
      continue;
    }

    const match = /^Read\((.*)\)$/.exec(rule);

    if (!match) {
      continue;
    }

    let pattern = match[1].trim();
    const negated = pattern.startsWith("!");

    if (negated) {
      pattern = pattern.slice(1);
    }

    const regex = readPatternRegex(pattern);

    if (regex?.test(file)) {
      covered = !negated;
    }
  }

  return covered;
}

function readPatternRegex(pattern) {
  if (!pattern || pattern.startsWith("//") || pattern.startsWith("~") || pattern.startsWith("/")) {
    return undefined;
  }

  let anchored = pattern;

  if (anchored.startsWith("./")) {
    anchored = anchored.slice(2);
  } else if (!anchored.includes("/")) {
    anchored = `**/${anchored}`;
  }

  if (anchored.endsWith("/")) {
    anchored = `${anchored}**`;
  }

  return new RegExp(`^${globToRegex(anchored)}$`);
}

function globToRegex(glob) {
  let out = "";

  for (let index = 0; index < glob.length; index++) {
    const character = glob[index];

    if (character === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        out += "(?:.*/)?";
        index += 2;
      } else {
        out += ".*";
        index += 1;
      }
    } else if (character === "*") {
      out += "[^/]*";
    } else if (character === "?") {
      out += "[^/]";
    } else {
      out += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  return out;
}

/**
 * Bash rule matching as documented: `*` stands for any text; a trailing ` *`
 * or `:*` that is the rule's only wildcard also matches the bare command.
 */
export function bashMatches(rule, command) {
  if (rule === "Bash" || rule === "Bash(*)") {
    return true;
  }

  const match = /^Bash\((.*)\)$/.exec(rule);

  if (!match) {
    return false;
  }

  let pattern = match[1];

  if (pattern.endsWith(":*")) {
    pattern = `${pattern.slice(0, -2)} *`;
  }

  const wildcards = pattern.split("*").length - 1;

  if (wildcards === 1 && pattern.endsWith(" *") && command === pattern.slice(0, -2)) {
    return true;
  }

  const regex = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");

  return new RegExp(`^${regex}$`).test(command);
}

function isSecretName(file) {
  const name = path.posix.basename(file);

  if (TEMPLATE_SUFFIXES.test(name)) {
    return false;
  }

  return name === ".env" || name.startsWith(".env.") || name.endsWith(".pem") || name.endsWith(".key");
}

function denyRules(settings) {
  const deny = settings?.permissions?.deny;

  return Array.isArray(deny) ? deny.filter((rule) => typeof rule === "string") : [];
}

function hookCommands(settings) {
  const events = settings?.hooks && typeof settings.hooks === "object" ? Object.values(settings.hooks) : [];

  return events.flat()
    .flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : []))
    .map((hook) => hook?.command)
    .filter((command) => typeof command === "string")
    .map((command) => command.replace(/^["']?\$\{?CLAUDE_PROJECT_DIR\}?["']?\/?/, ""));
}

/** Shell comments mention "git commit" in prose; only code can mis-match it. */
function stripComments(contents) {
  return contents.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
}

function finding(code, severity, { message, file, fix }) {
  return { code, severity, message, ...(file ? { file } : {}), fix };
}

function byCodeThenFile(left, right) {
  return left.code.localeCompare(right.code) || (left.file ?? "").localeCompare(right.file ?? "");
}
