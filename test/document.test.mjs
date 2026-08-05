import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTemplate,
  missingPlaceholders,
  normalizeDocument,
  renderSections,
  stripFrontmatter,
} from "../src/render/document.mjs";

test("sections render in order with separators between them", () => {
  const rendered = renderSections(
    [{ id: "one", content: "first" }, { id: "two", content: "second" }],
    "Rule"
  );

  assert.equal(rendered, "## Rule: one\n\nfirst\n\n---\n\n## Rule: two\n\nsecond");
});

test("an empty section list renders nothing", () => {
  assert.equal(renderSections([], "Agent"), "");
});

test("frontmatter is removed when content is inlined", () => {
  assert.equal(stripFrontmatter("---\nname: x\n---\nbody\n"), "body\n");
  assert.equal(stripFrontmatter("no frontmatter\n"), "no frontmatter\n");
  assert.equal(
    stripFrontmatter("text\n\n---\n\nmore\n"),
    "text\n\n---\n\nmore\n",
    "a thematic break inside content is not frontmatter"
  );
});

test("normalization drops separators left dangling by an empty section", () => {
  const document = applyTemplate("{{RULES}}\n\n---\n\n{{AGENTS}}\n", {
    RULES: "## Rule: one\n\nfirst",
    AGENTS: "",
  });

  assert.equal(normalizeDocument(document), "## Rule: one\n\nfirst\n");
});

test("normalization keeps separators that sit between content", () => {
  const document = normalizeDocument("a\n\n---\n\nb\n");

  assert.equal(document, "a\n\n---\n\nb\n");
});

test("normalization collapses blank runs and strips authoring notes", () => {
  const document = normalizeDocument("<!-- aie:note explain -->\n# Title\n\n\n\nbody\n\n\n");

  assert.equal(document, "# Title\n\nbody\n");
});

test("missing placeholders are detected", () => {
  assert.deepEqual(missingPlaceholders("{{RULES}}", ["RULES", "AGENTS"]), ["AGENTS"]);
  assert.deepEqual(missingPlaceholders("{{RULES}}{{AGENTS}}", ["RULES", "AGENTS"]), []);
});
