import process from "node:process";

import packageJson from "../../package.json" with { type: "json" };

export async function run(argv, options = {}) {
  const command = argv[0] ?? "sync";
  const root = options.root ?? process.cwd();

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageJson.version);
    return 0;
  }

  if (command === "init") {
    const { initializeWorkspace } = await import("../workspace/init.mjs");
    const result = await initializeWorkspace(root);
    printInitialization(result);
    return 0;
  }

  if (command === "sync") {
    const { compile } = await import("../compiler/compile.mjs");
    const result = await compile({ root });
    printCompilation(result);
    return 0;
  }

  if (command === "validate") {
    const { validate } = await import("../compiler/compile.mjs");
    await validate({ root });
    console.log(".ai workspace is valid.");
    return 0;
  }

  throw new Error(
    `Unknown command "${command}". Use "ai --help" for usage.`
  );
}

function printHelp() {
  console.log(`AI Engineering OS ${packageJson.version}

Usage:
  ai init       Create a minimal .ai workspace
  ai sync       Compile enabled runtime adapters
  ai validate   Validate the .ai workspace without generating files
  ai --help     Show this help
  ai --version  Show the installed version`);
}

function printInitialization(result) {
  if (result.created.length) {
    for (const item of result.created) {
      console.log(`✓ Created ${item}`);
    }
  } else {
    console.log("✓ .ai workspace already exists");
  }

  console.log(`
Next steps:

1. Add project rules to .ai/rules
2. Add project agents to .ai/agents
3. Run:

   ai sync`);
}

function printCompilation(result) {
  for (const target of result.targets) {
    console.log(`Compiled ${target.id}: ${target.files} file(s).`);
  }
}
