import path from "node:path";

import { auditClaude } from "./claude.mjs";
import { collectSnapshot } from "./snapshot.mjs";

/**
 * Audits the repository's committed agent configuration. Writes nothing and
 * needs no .ai workspace. Only Claude Code has rules today; another runtime's
 * would be another module beside claude.mjs.
 */
export async function audit(root) {
  const snapshot = await collectSnapshot(path.resolve(root));

  return auditClaude(snapshot);
}
