#!/usr/bin/env node

import { run } from "../src/cli/run.mjs";

try {
  const exitCode = await run(process.argv.slice(2));
  process.exitCode = exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
