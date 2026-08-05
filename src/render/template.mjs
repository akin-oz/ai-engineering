import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTextIfExists } from "../filesystem.mjs";
import { missingPlaceholders } from "./document.mjs";

const BUILT_IN = fileURLToPath(new URL("../templates/", import.meta.url));

/**
 * Resolves a runtime template from the workspace, falling back to the built-in
 * template shipped with the package so a fresh workspace always compiles.
 */
export async function resolveTemplate(manifest, options) {
  const { name, legacyName, required = [], diagnostics } = options;
  const workspaceFile = path.join(manifest.files.templates, `${name}.md`);
  const workspace = await readTextIfExists(workspaceFile);

  let content = workspace;
  let file = workspaceFile;

  if (content === undefined && legacyName) {
    const legacyFile = path.join(manifest.files.templates, `${legacyName}.md`);
    const legacy = await readTextIfExists(legacyFile);

    if (legacy !== undefined) {
      diagnostics.push({
        severity: "warning",
        code: "template-deprecated-name",
        message: `Template "${legacyName}.md" is deprecated. Rename it to "${name}.md".`,
        file: path.relative(manifest.root, legacyFile),
      });

      content = legacy;
      file = legacyFile;
    }
  }

  if (content === undefined) {
    content = await readTextIfExists(path.join(BUILT_IN, `${name}.md`));
    file = undefined;
  }

  if (content === undefined) {
    diagnostics.push({
      severity: "error",
      code: "template-missing",
      message: `No template found for "${name}"`,
    });

    return { content: "", file };
  }

  const missing = missingPlaceholders(content, required);

  if (missing.length) {
    diagnostics.push({
      severity: "error",
      code: "template-missing-placeholder",
      message: `Template is missing ${missing.map((item) => `{{${item}}}`).join(", ")}, so declared ${missing
        .map((item) => item.toLowerCase())
        .join(" and ")} would never reach the generated file.`,
      file: file ? path.relative(manifest.root, file) : `${name}.md (built-in)`,
    });
  }

  return { content, file };
}
