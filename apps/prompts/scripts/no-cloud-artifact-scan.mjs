#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

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

const artifact = resolvePackArtifact()
const paths = new Set((artifact.files ?? []).map((entry) => entry.path))

const hits = []
for (const entry of artifact.files ?? []) {
  const path = entry.path
  try {
    const content = readFileSync(path, "utf8")
    for (const marker of forbiddenMarkers) {
      if (content.includes(marker)) hits.push(`${path}: ${marker}`)
    }
  } catch {
    // Ignore binary/generated files that are not readable as UTF-8.
  }
}

if (hits.length > 0) {
  console.error("Packed artifact contains retired cloud runtime markers:")
  for (const hit of hits) console.error(`- ${hit}`)
  process.exit(1)
}

console.log(`Packed artifact no-cloud scan passed (${artifact.files?.length ?? 0} files).`)

function resolvePackArtifact() {
  const npmPack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  })
  if (npmPack.status === 0) {
    const [artifact] = JSON.parse(npmPack.stdout ?? "[]")
    if (artifact) return artifact
  }

  const bunPack = spawnSync("bun", ["pm", "pack", "--dry-run", "--ignore-scripts"], {
    encoding: "utf8",
  })
  if (bunPack.status === 0) {
    const files = parseBunPackFiles(bunPack.stdout ?? "")
    if (files.length > 0) return { files: files.map((path) => ({ path })) }
  }

  process.stderr.write(npmPack.stderr ?? npmPack.stdout ?? "")
  process.stderr.write(bunPack.stderr ?? bunPack.stdout ?? "")
  console.error("Package dry-run metadata could not be read from npm or bun.")
  process.exit(npmPack.status ?? bunPack.status ?? 1)
}

function parseBunPackFiles(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^packed\s+\S+\s+(.+)$/)?.[1])
    .filter(Boolean)
}
