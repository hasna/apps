// The version is read from the app manifest — the same file the version wave
// bumps and the same file the Docker image ships — so the live /version,
// CLI and MCP versions cannot drift from the release (the I38-00565 class).
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const version: string = manifest.version;
