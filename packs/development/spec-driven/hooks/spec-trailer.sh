#!/bin/sh
# Refuses a `git commit` that does not say which spec it implements.
#
# The spec-driven workflow says behavior changes start from a written spec. A
# commit trailer is what makes that checkable afterwards, by a reviewer or by
# CI, rather than remembered:
#
#     Spec: 004
#     Spec: none — refactor, no behavior change
#
# Reads the Claude Code hook payload on stdin. The decision is made by the node
# program below, which reads the Bash command the way a shell would: it finds
# git wherever it runs (after `-C dir`, inside `$(...)`, behind `env` or
# `sh -c`), reads the commit message out of `-m`, `-F`, here-documents, and
# reused commits, and asks `git interpret-trailers` whether that message has a
# `Spec:` trailer. It does not guess: a message it cannot read without running
# something is refused, with instructions.
#
# Fails open when the hook itself breaks: no node, no git, a malformed payload,
# or a crash in the program all allow the commit, because a hook bug must never
# be the reason someone cannot commit. Only an explicit decision blocks.
#
# The program is a single-quoted shell string, so it contains no single quotes.

set -u

decision="$(node -e '
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Stands in for text that is only known once the shell runs: a variable, a
// command substitution, an expanding here-document.
const UNKNOWN = "\u0000";
const MAX_DEPTH = 32;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);
const INTERPRETER = /^(python[0-9.]*|node(js)?|perl|ruby|deno|bun)$/;
const GIT = new Set(["git", "git.exe"]);
const GIT_OPTIONS_WITH_VALUE = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
]);

// Long options of git commit. Git accepts any unambiguous prefix, so the whole
// set is needed to resolve one, not only the options that matter here.
const COMMIT_OPTIONS = new Map([
  ["--message", true], ["--file", true], ["--reuse-message", true],
  ["--reedit-message", true], ["--fixup", true], ["--squash", true],
  ["--trailer", true], ["--author", true], ["--date", true],
  ["--template", true], ["--cleanup", true], ["--pathspec-from-file", true],
  ["--amend", false], ["--no-edit", false], ["--edit", false], ["--all", false],
  ["--patch", false], ["--interactive", false], ["--include", false],
  ["--only", false], ["--signoff", false], ["--no-signoff", false],
  ["--verbose", false], ["--quiet", false], ["--dry-run", false],
  ["--short", false], ["--branch", false], ["--porcelain", false],
  ["--long", false], ["--null", false], ["--reset-author", false],
  ["--no-verify", false], ["--verify", false], ["--allow-empty", false],
  ["--allow-empty-message", false], ["--untracked-files", false],
  ["--gpg-sign", false], ["--no-gpg-sign", false], ["--no-post-rewrite", false],
  ["--status", false], ["--no-status", false], ["--pathspec-file-nul", false],
]);

class Refusal extends Error {}

const NO_TRAILER = `
This commit does not say which spec it implements.

Add a trailer as the last paragraph of the commit message:

    Spec: 004                        the spec this change implements
    Spec: none — refactor            no behavior change, so no spec is needed

If the behavior change has no spec yet, write the spec first — that is the
workflow this repository selected.
`;

const UNREADABLE_MESSAGE = `
This commit message cannot be read without running something, so it cannot be
checked for a Spec: trailer.

Write the message literally, with -m or a quoted here-document:

    git commit -F - <<\x27EOF\x27
    Subject line

    Spec: 004
    EOF
`;

const UNREADABLE_COMMAND = `
This command may run git commit in a way that cannot be read without running
it (a variable, a generated script, or code handed to another program), so the
commit cannot be checked for a Spec: trailer.

Run git commit directly, with the message written literally.
`;

function parse(source, depth) {
  const lexer = { source, i: 0, pending: [] };
  const commands = [];

  parseList(lexer, commands, depth, false);
  return commands;
}

function newCommand() {
  return { words: [], heredoc: null, herestring: null };
}

function parseList(lexer, out, depth, insideSubstitution) {
  if (depth > MAX_DEPTH) throw new Refusal(UNREADABLE_COMMAND);

  const s = lexer.source;
  let command = newCommand();
  const finish = () => {
    if (command.words.length || command.heredoc || command.herestring) out.push(command);
    command = newCommand();
  };

  while (lexer.i < s.length) {
    const c = s[lexer.i];

    if (c === " " || c === "\t") {
      lexer.i++;
    } else if (c === "\n") {
      lexer.i++;
      readHeredocs(lexer);
      finish();
    } else if (c === "#") {
      while (lexer.i < s.length && s[lexer.i] !== "\n") lexer.i++;
    } else if (c === ")" && insideSubstitution) {
      lexer.i++;
      finish();
      return;
    } else if (c === ";" || c === "(" || c === ")" || c === "|" || c === "&") {
      if (c === "&" && s[lexer.i + 1] === ">") {
        lexer.i += s[lexer.i + 2] === ">" ? 3 : 2;
        readTarget(lexer, out, depth);
      } else {
        lexer.i += s[lexer.i + 1] === c || (c === "|" && s[lexer.i + 1] === "&") ? 2 : 1;
        finish();
      }
    } else if (c === "<" || c === ">") {
      readRedirection(lexer, out, depth, command);
    } else {
      const word = readWord(lexer, out, depth);
      const next = s[lexer.i];
      // "2>&1": a bare number touching a redirection is its file descriptor.
      if ((next === "<" || next === ">") && !word.quoted && /^[0-9]+$/.test(word.text)) continue;
      command.words.push(word);
    }
  }

  if (insideSubstitution) throw new Refusal(UNREADABLE_COMMAND);
  readHeredocs(lexer);
  finish();
}

function readRedirection(lexer, out, depth, command) {
  const s = lexer.source;

  if (s.startsWith("<<<", lexer.i)) {
    lexer.i += 3;
    command.herestring = readTarget(lexer, out, depth);
  } else if (s.startsWith("<<", lexer.i)) {
    lexer.i += 2;
    const strip = s[lexer.i] === "-";
    if (strip) lexer.i++;
    const delimiter = readTarget(lexer, out, depth);
    lexer.pending.push({ command, delimiter: delimiter.text, quoted: delimiter.quoted, strip });
  } else {
    lexer.i++;
    while (lexer.i < s.length && ">&|".includes(s[lexer.i])) lexer.i++;
    readTarget(lexer, out, depth);
  }
}

function readTarget(lexer, out, depth) {
  const s = lexer.source;
  while (s[lexer.i] === " " || s[lexer.i] === "\t") lexer.i++;
  return readWord(lexer, out, depth);
}

function readHeredocs(lexer) {
  const s = lexer.source;

  for (const heredoc of lexer.pending) {
    const lines = [];

    while (lexer.i < s.length) {
      let end = s.indexOf("\n", lexer.i);
      if (end < 0) end = s.length;
      let line = s.slice(lexer.i, end);
      lexer.i = Math.min(end + 1, s.length);
      if (heredoc.strip) line = line.replace(/^\t+/, "");
      if (line === heredoc.delimiter) break;
      lines.push(line);
    }

    const body = lines.length ? `${lines.join("\n")}\n` : "";
    heredoc.command.heredoc = heredoc.quoted ? body : expandHeredoc(body);
  }

  lexer.pending = [];
}

function expandHeredoc(body) {
  let text = "";

  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === "\\" && "$`\\\n".includes(body[k + 1] ?? "")) {
      if (body[k + 1] !== "\n") text += body[k + 1];
      k++;
    } else if (c === "$" || c === "`") {
      text += UNKNOWN;
    } else {
      text += c;
    }
  }

  return text;
}

function readWord(lexer, out, depth) {
  const s = lexer.source;
  const word = { text: "", quoted: false, glob: false };

  while (lexer.i < s.length) {
    const c = s[lexer.i];

    if (" \t\n;&|()<>".includes(c)) break;

    if (c === "\\") {
      if (s[lexer.i + 1] !== "\n") {
        word.text += s[lexer.i + 1] ?? "";
        word.quoted = true;
      }
      lexer.i += 2;
    } else if (c === "\x27") {
      const end = s.indexOf("\x27", lexer.i + 1);
      if (end < 0) throw new Refusal(UNREADABLE_COMMAND);
      word.text += s.slice(lexer.i + 1, end);
      word.quoted = true;
      lexer.i = end + 1;
    } else if (c === "\"") {
      lexer.i++;
      readDoubleQuoted(lexer, out, depth, word);
      word.quoted = true;
    } else if (c === "$" && s[lexer.i + 1] === "\x27") {
      lexer.i += 2;
      word.text += readAnsiC(lexer);
      word.quoted = true;
    } else if (c === "$") {
      readDollar(lexer, out, depth, word);
    } else if (c === "`") {
      readBackticks(lexer, out, depth, word);
    } else {
      if ("*?[".includes(c)) word.glob = true;
      word.text += c;
      lexer.i++;
    }
  }

  return word;
}

function readDoubleQuoted(lexer, out, depth, word) {
  const s = lexer.source;

  for (;;) {
    if (lexer.i >= s.length) throw new Refusal(UNREADABLE_COMMAND);
    const c = s[lexer.i];

    if (c === "\"") {
      lexer.i++;
      return;
    } else if (c === "\\" && "$`\"\\\n".includes(s[lexer.i + 1] ?? "")) {
      if (s[lexer.i + 1] !== "\n") word.text += s[lexer.i + 1];
      lexer.i += 2;
    } else if (c === "$") {
      readDollar(lexer, out, depth, word);
    } else if (c === "`") {
      readBackticks(lexer, out, depth, word);
    } else {
      word.text += c;
      lexer.i++;
    }
  }
}

function readAnsiC(lexer) {
  const s = lexer.source;
  const escapes = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v" };
  let text = "";

  for (;;) {
    if (lexer.i >= s.length) throw new Refusal(UNREADABLE_COMMAND);
    const c = s[lexer.i];

    if (c === "\x27") {
      lexer.i++;
      return text;
    }
    if (c === "\\") {
      const next = s[lexer.i + 1] ?? "";
      text += escapes[next] ?? next;
      lexer.i += 2;
    } else {
      text += c;
      lexer.i++;
    }
  }
}

function readDollar(lexer, out, depth, word) {
  const s = lexer.source;
  const next = s[lexer.i + 1] ?? "";

  if (next === "(" && s[lexer.i + 2] === "(") {
    // Arithmetic: its value is a number, never a command or a message.
    let open = 0;
    for (lexer.i += 1; lexer.i < s.length; lexer.i++) {
      if (s[lexer.i] === "(") open++;
      if (s[lexer.i] === ")" && --open === 0) break;
    }
    lexer.i++;
    word.text += UNKNOWN;
  } else if (next === "(") {
    lexer.i += 2;
    const inner = [];
    parseList(lexer, inner, depth + 1, true);
    out.push(...inner);
    word.text += staticOutput(inner) ?? UNKNOWN;
  } else if (next === "{") {
    // `${X:-$(git commit)}` runs the substitution inside, so the operand is
    // read word by word for substitutions; its value is still unknown.
    const end = closingBrace(s, lexer.i + 1);
    if (end < 0) throw new Refusal(UNREADABLE_COMMAND);
    const inner = { source: s.slice(lexer.i + 2, end), i: 0, pending: [] };
    while (inner.i < inner.source.length) {
      if (" \t\n;&|()<>".includes(inner.source[inner.i])) {
        inner.i++;
      } else {
        readWord(inner, out, depth + 1);
      }
    }
    lexer.i = end + 1;
    word.text += UNKNOWN;
  } else if (/[A-Za-z_]/.test(next)) {
    lexer.i++;
    while (/[A-Za-z0-9_]/.test(s[lexer.i] ?? "")) lexer.i++;
    word.text += UNKNOWN;
  } else if (/[0-9@*#?$!-]/.test(next)) {
    lexer.i += 2;
    word.text += UNKNOWN;
  } else {
    word.text += "$";
    lexer.i++;
  }
}

function closingBrace(s, open) {
  let depth = 0;

  for (let k = open; k < s.length; k++) {
    if (s[k] === "\\") {
      k++;
    } else if (s[k] === "\x27") {
      const end = s.indexOf("\x27", k + 1);
      if (end < 0) return -1;
      k = end;
    } else if (s[k] === "{") {
      depth++;
    } else if (s[k] === "}" && --depth === 0) {
      return k;
    }
  }
  return -1;
}

function readBackticks(lexer, out, depth, word) {
  const s = lexer.source;
  let raw = "";

  for (lexer.i++; ; lexer.i++) {
    if (lexer.i >= s.length) throw new Refusal(UNREADABLE_COMMAND);
    const c = s[lexer.i];
    if (c === "`") break;
    if (c === "\\" && "`$\\".includes(s[lexer.i + 1] ?? "")) {
      raw += s[++lexer.i];
    } else {
      raw += c;
    }
  }
  lexer.i++;

  const inner = parse(raw, depth + 1);
  out.push(...inner);
  word.text += staticOutput(inner) ?? UNKNOWN;
}

// The one substitution whose output is known without running it: `cat` of a
// here-document, which is how agents pass multi-line commit messages.
function staticOutput(commands) {
  if (commands.length !== 1) return null;
  const [command] = commands;
  if (command.words.length !== 1 || command.words[0].text !== "cat") return null;
  if (command.heredoc === null || command.herestring) return null;
  return command.heredoc.replace(/\n+$/, "");
}

const unknown = (word) => word.text.includes(UNKNOWN);
const basename = (text) => text.slice(text.lastIndexOf("/") + 1);

function judge(source, cwd, depth) {
  let commands;
  try {
    commands = parse(source, depth);
  } catch (error) {
    // A command a shell would reject runs nothing; one this parser cannot
    // follow might. Refuse only when it could be a commit.
    if (error instanceof Refusal && !/commit/.test(source)) return null;
    throw error;
  }

  for (const command of commands) {
    const verdict = inspect(command, cwd, depth);
    if (verdict) return verdict;
  }
  return null;
}

function inspect(command, cwd, depth) {
  const { words } = command;

  for (let k = 0; k < words.length; k++) {
    const word = words[k];
    const name = basename(word.text);

    if (unknown(word) || word.glob) {
      // `$GIT commit`: a program chosen at runtime, followed by a commit.
      const git = gitSubcommand(words, k + 1, cwd);
      if (git?.subcommand.text === "commit") return inspectCommit(words.slice(git.index + 1), command, git.directory);
      continue;
    }

    if (GIT.has(name)) {
      const git = gitSubcommand(words, k + 1, cwd);
      if (!git) continue;
      if (unknown(git.subcommand)) throw new Refusal(UNREADABLE_COMMAND);
      if (git.subcommand.text === "commit") {
        const verdict = inspectCommit(words.slice(git.index + 1), command, git.directory);
        if (verdict) return verdict;
      }
    } else if (SHELLS.has(name)) {
      const script = shellScript(words, k + 1);
      if (script) {
        if (unknown(script)) {
          if (/commit/.test(script.text)) throw new Refusal(UNREADABLE_COMMAND);
        } else {
          const verdict = judge(script.text, cwd, depth + 1);
          if (verdict) return verdict;
        }
      }
    } else if (name === "eval") {
      const script = words.slice(k + 1).map((item) => item.text).join(" ");
      if (script.includes(UNKNOWN)) {
        if (/commit/.test(script)) throw new Refusal(UNREADABLE_COMMAND);
      } else {
        const verdict = judge(script, cwd, depth + 1);
        if (verdict) return verdict;
      }
      return null;
    } else if (INTERPRETER.test(name)) {
      if (words.slice(k + 1).some((item) => /\bgit\b[\s\S]*\bcommit\b/.test(item.text))) {
        throw new Refusal(UNREADABLE_COMMAND);
      }
    }
  }

  return null;
}

// The script a shell runs with -c, past options such as `-o pipefail` and
// `--norc`. A first operand that is not an option is a script file, unread.
function shellScript(words, start) {
  for (let k = start; k < words.length; k++) {
    const text = words[k].text;
    if (/^[-+][oO]$/.test(text) || text === "--rcfile" || text === "--init-file") {
      k++;
    } else if (text.startsWith("--")) {
      continue;
    } else if (/^[-+][A-Za-z]+$/.test(text)) {
      if (text.startsWith("-") && text.includes("c")) return words[k + 1] ?? null;
    } else {
      return null;
    }
  }
  return null;
}

function gitSubcommand(words, start, cwd) {
  let directory = cwd;
  let k = start;

  while (k < words.length) {
    const word = words[k];
    if (unknown(word) || !word.text.startsWith("-")) break;
    if (GIT_OPTIONS_WITH_VALUE.has(word.text)) {
      const value = words[k + 1];
      if (word.text === "-C" && value) {
        directory = unknown(value) ? null : path.resolve(directory ?? "", value.text);
      }
      k += 2;
    } else {
      k++;
    }
  }

  if (k >= words.length) return null;
  return { subcommand: words[k], index: k, directory };
}

function resolveLongOption(name) {
  if (COMMIT_OPTIONS.has(name)) return name;
  const candidates = [...COMMIT_OPTIONS.keys()].filter((option) => option.startsWith(name));
  return candidates.length === 1 ? candidates[0] : name;
}

function sliceWord(word, from) {
  return { text: word.text.slice(from), quoted: word.quoted, glob: false };
}

function inspectCommit(args, command, directory) {
  const messages = [];
  const trailers = [];
  let file = null;
  let reuse = null;
  let keepsMessage = false;

  const assign = (option, value) => {
    if (!value) return;
    if (option === "m" || option === "--message") messages.push(value);
    else if (option === "F" || option === "--file") file = value;
    else if (option === "C" || option === "c" || option === "--reuse-message" || option === "--reedit-message") reuse = value;
    else if (option === "--trailer") trailers.push(value);
    else if (option === "--fixup" || option === "--squash") keepsMessage = true;
  };

  for (let k = 0; k < args.length; k++) {
    const word = args[k];
    const text = word.text;

    if (unknown(word)) throw new Refusal(UNREADABLE_COMMAND);
    if (text === "--") break;
    if (!text.startsWith("-") || text === "-") continue;

    if (text.startsWith("--")) {
      const equals = text.indexOf("=");
      const option = resolveLongOption(equals < 0 ? text : text.slice(0, equals));
      if (option === "--amend" || option === "--no-edit") keepsMessage = true;
      if (COMMIT_OPTIONS.get(option)) {
        assign(option, equals < 0 ? args[++k] : sliceWord(word, equals + 1));
      }
      continue;
    }

    for (let j = 1; j < text.length; j++) {
      const option = text[j];
      if ("mFCct".includes(option)) {
        assign(option, j + 1 < text.length ? sliceWord(word, j + 1) : args[++k]);
        break;
      }
      // -S and -u take an optional value that can only be attached.
      if (option === "S" || option === "u") break;
    }
  }

  if (trailers.some((value) => !unknown(value) && /^Spec\s*[:=]\s*\S/.test(value.text))) return null;

  let message;
  if (messages.length) {
    if (messages.some(unknown)) throw new Refusal(UNREADABLE_MESSAGE);
    message = messages.map((value) => value.text).join("\n\n");
  } else if (file) {
    message = readMessageFile(file, command, directory);
  } else if (reuse) {
    if (unknown(reuse) || reuse.text.startsWith("-") || directory === null) throw new Refusal(UNREADABLE_MESSAGE);
    message = git(["show", "-s", "--format=%B", reuse.text], directory);
  } else if (keepsMessage) {
    return null;
  } else {
    return NO_TRAILER;
  }

  return hasSpecTrailer(message, directory) ? null : NO_TRAILER;
}

function readMessageFile(file, command, directory) {
  if (unknown(file)) throw new Refusal(UNREADABLE_MESSAGE);

  if (file.text === "-") {
    const input = command.heredoc ?? (command.herestring ? `${command.herestring.text}\n` : null);
    if (input === null || input.includes(UNKNOWN)) throw new Refusal(UNREADABLE_MESSAGE);
    return input;
  }

  if (directory === null) throw new Refusal(UNREADABLE_MESSAGE);
  try {
    return fs.readFileSync(path.resolve(directory, file.text), "utf8");
  } catch {
    throw new Refusal(UNREADABLE_MESSAGE);
  }
}

function git(args, directory, input) {
  const result = spawnSync("git", args, {
    cwd: directory && fs.existsSync(directory) ? directory : undefined,
    input,
    encoding: "utf8",
  });
  // Any failure here is the hook breaking, not the commit being wrong.
  if (result.error || result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout;
}

// Git decides what a trailer is, so this hook and `git log --format=%(trailers)`
// in CI cannot disagree.
function hasSpecTrailer(message, directory) {
  const trailers = git(["interpret-trailers", "--parse"], directory, message);
  return /^Spec:[ \t]*\S/m.test(trailers);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const commandLine = payload?.tool_input?.command;
if (typeof commandLine !== "string" || !commandLine) process.exit(0);
const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();

let verdict;
try {
  verdict = judge(commandLine, cwd, 0);
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  verdict = error.message;
}

if (verdict) process.stdout.write(`block${verdict.replace(/^\n/, "")}`);
' 2>/dev/null)" || decision=""

case "$decision" in
  block*)
    printf '%s\n' "${decision#block}" >&2
    exit 2
    ;;
esac

exit 0
