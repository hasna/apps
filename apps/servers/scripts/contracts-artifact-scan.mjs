#!/usr/bin/env node
// Runs the @hasna/contracts packed-artifact scan against a REAL tarball.
//
// `contracts artifact-scan` also accepts a directory, but a directory only
// covers dist/ — it misses skills/, README.md, and LICENSE, which ship in the
// published package. Packing first is the only way the gate sees exactly what
// npm would publish. --ignore-scripts keeps this from re-entering prepack.
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { runContracts } from "./contracts-cli.mjs"

function writeFailure(prefix, result) {
  const stderr = result.stderr?.toString?.() ?? ""
  const stdout = result.stdout?.toString?.() ?? ""
  if (stderr) process.stderr.write(stderr)
  else if (stdout) process.stderr.write(stdout)
  else process.stderr.write(`${prefix} failed with no output\n`)
}

function packWithNpm(destination) {
  // This scan runs from `prepack`, which the publish guard triggers through
  // `npm pack --dry-run --json`. npm forwards its config to lifecycle scripts
  // as env vars, so the nested pack inherits the outer dry-run env flag and
  // silently dry-runs (rc=0, zero tarballs) unless that flag is stripped.
  const env = { ...process.env }
  delete env[["npm_", "config_", "dry_run"].join("")]
  const result = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", destination],
    { encoding: "utf8", env },
  )

  if (result.error?.code === "ENOENT") return null
  if (result.status !== 0) {
    writeFailure("npm pack", result)
    process.exit(result.status ?? 1)
  }

  return "npm"
}

function packWithBun(destination) {
  const result = spawnSync(
    "bun",
    ["pm", "pack", "--ignore-scripts", "--destination", destination],
    { encoding: "utf8" },
  )

  if (result.status !== 0) {
    writeFailure("bun pm pack", result)
    process.exit(result.status ?? 1)
  }

  return "bun"
}

const destination = mkdtempSync(join(tmpdir(), "servers-artifact-scan-"))

try {
  const packer = packWithNpm(destination) ?? packWithBun(destination)
  const tarballs = readdirSync(destination).filter((entry) => entry.endsWith(".tgz"))

  if (tarballs.length !== 1) {
    console.error(
      `Packed artifact scan expected exactly one tarball from ${packer}, found ${tarballs.length}.`,
    )
    process.exit(1)
  }

  const scanStatus = runContracts(["artifact-scan", join(destination, tarballs[0])], {
    stdio: "inherit",
  })

  if (scanStatus !== 0) process.exit(scanStatus)
} finally {
  rmSync(destination, { recursive: true, force: true })
}
