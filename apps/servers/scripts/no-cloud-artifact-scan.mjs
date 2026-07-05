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

function writeFailure(prefix, result) {
  const stderr = result.stderr?.toString?.() ?? ""
  const stdout = result.stdout?.toString?.() ?? ""
  if (stderr) process.stderr.write(stderr)
  else if (stdout) process.stderr.write(stdout)
  else process.stderr.write(`${prefix} failed with no output\n`)
}

function packWithNpm() {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  })

  if (result.error?.code === "ENOENT") return null
  if (result.status !== 0) {
    writeFailure("npm pack", result)
    process.exit(result.status ?? 1)
  }

  const [artifact] = JSON.parse(result.stdout)
  return {
    packer: "npm",
    files: (artifact.files ?? []).map((entry) => entry.path),
  }
}

function packWithBun() {
  const result = spawnSync("bun", ["pm", "pack", "--dry-run", "--ignore-scripts"], {
    encoding: "utf8",
  })

  if (result.status !== 0) {
    writeFailure("bun pm pack", result)
    process.exit(result.status ?? 1)
  }

  return {
    packer: "bun",
    files: result.stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^packed\s+\S+\s+(.+)$/)?.[1])
      .filter(Boolean),
  }
}

const artifact = packWithNpm() ?? packWithBun()
if (artifact.files.length === 0) {
  console.error("Packed artifact scan could not determine package files.")
  process.exit(1)
}

const hits = []

for (const path of artifact.files) {
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

console.log(`Packed artifact no-cloud scan passed (${artifact.files.length} files via ${artifact.packer}).`)
