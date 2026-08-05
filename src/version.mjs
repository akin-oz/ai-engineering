import packageJson from "../package.json" with { type: "json" };

export const NAME = packageJson.name;
export const VERSION = packageJson.version;

/** Recorded in ownership records so a generated tree names the tool that wrote it. */
export const GENERATOR = `${packageJson.name}@${packageJson.version}`;
