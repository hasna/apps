import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Scope (reviewed in the storage-core patch): this boundary bans retired
 * shared-cloud runtime markers and the retired storage-mode/registry-selector
 * SHAPES, and it must NOT ban the sanctioned two-backend contract. The fleet
 * contract names `HASNA_<NAME>_API_URL`, `HASNA_<NAME>_API_KEY`, and
 * `HASNA_<NAME>_DATABASE_URL` — a client is exactly local-SQLite-or-HTTP and a
 * server is exactly SQLite-or-PostgreSQL, so those env names are legal and
 * MUST NOT be added to this list.
 *
 * The one exception to the shape bans is `src/client-transport.ts`: it is the
 * fail-loud ratchet that names the retired variables so a stale station
 * fragment is rejected instead of silently ignored. Every other source file
 * must stay free of the retired shapes.
 */
const forbiddenMarkers = [
  ["@hasna", "cloud"].join("/"),
  ["open", "cloud"].join("-"),
  ["cloud", "mcp"].join("-"),
  ["register", "Cloud", "Tools"].join(""),
  ["register", "Cloud", "Commands"].join(""),
  [".hasna", "cloud"].join("/"),
  ["HASNA", "CLOUD", ""].join("_"),
  ["HASNA", "RDS"].join("_"),
  ["Sqlite", "Adapter"].join(""),
  ["Pg", "Adapter"].join(""),
  ["cloud", "sync"].join(" "),
  // Retired mode-enum and registry-selector shapes. Only client-transport.ts
  // (the fail-loud ratchet) may name them.
  "STORAGE_MODE",
  "REGISTRY_POSTGRES_URL",
  "REGISTRY_S3_BUCKET",
]

const roots = ["package.json", "README.md", "src"]
const skipFiles = new Set([
  join("src", "no-cloud-boundary.test.ts"),
  // Fail-loud ratchet: names the retired selectors so it can reject them.
  join("src", "client-transport.ts"),
  // CI-verified generator output; the kit's legacy-mode guard names the
  // retired shapes by design (see vendor-kit --check).
  join("src", "generated", "storage-kit"),
  // Tests that intentionally set the retired selectors to prove the ratchet.
  join("src", "cli", "storage.cli.test.ts"),
  join("src", "db", "database.test.ts"),
  // README documents the retired selector names so operators can unset them.
  "README.md",
])

function isSkipped(file: string): boolean {
  for (const skip of skipFiles) {
    if (file === skip || file.startsWith(`${skip}/`)) return true
  }
  return false
}

function collectFiles(path: string): string[] {
  if (!existsSync(path)) return []
  const stat = statSync(path)
  if (stat.isFile()) return [path]
  return readdirSync(path).flatMap((entry) => collectFiles(join(path, entry)))
}

describe("no shared cloud runtime boundary", () => {
  test("package, docs, and runtime sources do not reference retired cloud runtime markers", () => {
    const hits: string[] = []
    for (const file of roots.flatMap(collectFiles)) {
      if (skipFiles.has(file)) continue
      const content = readFileSync(file, "utf8")
      if (isSkipped(file)) continue
      for (const marker of forbiddenMarkers) {
        if (content.includes(marker)) hits.push(`${file}: ${marker}`)
      }
    }
    expect(hits).toEqual([])
  })
})
