import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

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
]

const roots = ["package.json", "README.md", "src"]
const skipFiles = new Set([join("src", "no-cloud-boundary.test.ts")])

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
      for (const marker of forbiddenMarkers) {
        if (content.includes(marker)) hits.push(`${file}: ${marker}`)
      }
    }
    expect(hits).toEqual([])
  })
})
