#!/usr/bin/env node

import { run } from "../src/cli/run.mjs";

console.error('Warning: the "ai" command is deprecated and will be removed in 0.4.0. Use "aie" instead.');

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
