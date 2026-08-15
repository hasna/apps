/**
 * Single source of truth for the version the published bins report: package.json.
 *
 * Both bins (`sandboxes`, `sandboxes-mcp`) live exactly two directories below the
 * package root — `src/{cli,mcp}/index.ts` in source, `dist/{cli,mcp}/index.js`
 * once built — so each entrypoint passes its own `import.meta.url` and the
 * version is read from `../../package.json` at startup. This keeps the reported
 * version from ever drifting from the released one (bun's bundler rewrites
 * `import.meta.url` to the output file, which is why the caller must supply it
 * rather than this module using its own).
 */
import { readFileSync } from "node:fs"

export function resolvePackageVersion(entrypointUrl: string): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", entrypointUrl), "utf8")) as { version?: unknown }
    return typeof pkg.version === "string" ? pkg.version : "0.0.0"
  } catch {
    return "0.0.0"
  }
}
