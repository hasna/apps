import packageJson from "../package.json";

// Derived from package.json so a version bump (including the monorepo
// changesets path, which rewrites package.json only) can never leave the
// runtime surfaces — /version, CLI --version, MCP, OpenAPI — on a stale
// literal. Same pattern the tests and build_companion_cli.sh already use.
export const VERSION = packageJson.version;
