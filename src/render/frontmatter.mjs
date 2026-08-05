import { parse } from "yaml";

const PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Splits optional YAML frontmatter from a source file. `content` stays intact
 * for runtimes that consume the file verbatim; `body` is what gets inlined.
 */
export function splitFrontmatter(content) {
  const match = PATTERN.exec(content);

  if (!match) {
    return { metadata: undefined, body: content, raw: undefined };
  }

  return {
    metadata: parse(match[1]) ?? {},
    body: content.slice(match[0].length),
    raw: match[1],
  };
}

export function serializeFrontmatter(metadata) {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);

  if (!entries.length) {
    return "";
  }

  const lines = entries.map(([key, value]) => `${key}: ${formatValue(value)}`);

  return `---\n${lines.join("\n")}\n---\n`;
}

function formatValue(value) {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  const text = String(value);
  // Plain scalars keep globs readable, but a leading YAML indicator (`*` is an
  // alias, `{` a flow mapping) must always be quoted.
  const plain = /^[\w .,'()/@*{}[\]!?+=^~$-]+$/.test(text) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text);

  return plain ? text : JSON.stringify(text);
}
