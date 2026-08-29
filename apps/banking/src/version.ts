// Read version from package.json — never hardcode (mirrors apps/connectors + apps/testers).
// Both the CLI and the MCP entrypoints must report the version the package actually ships;
// a static JSON import is resolved at build time, so a changesets version bump flows through
// automatically and can never drift from package.json again.
import pkg from "../package.json";

export const VERSION: string = pkg.version;
