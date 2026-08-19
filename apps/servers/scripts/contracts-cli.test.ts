import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveContractsCli } from "./contracts-cli.mjs"

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(scriptsDir, "..", "package.json"), "utf8"))
const pinnedContractsVersion = packageJson.devDependencies["@hasna/contracts"]
const runner = join(scriptsDir, "contracts-cli.mjs")

describe("contracts CLI runner", () => {
  test("resolves the pinned package entry instead of a node_modules/.bin shim", () => {
    expect(resolveContractsCli()).toEndWith(join("dist", "cli", "index.js"))
    expect(resolveContractsCli()).not.toContain(join("node_modules", ".bin"))
  })

  test("runs when package-local node_modules/.bin is absent from PATH", () => {
    const result = spawnSync(process.execPath, [runner, "--version"], {
      cwd: dirname(scriptsDir),
      env: {
        ...process.env,
        PATH: "/usr/bin:/bin",
      },
      encoding: "utf8",
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(pinnedContractsVersion)
  })
})
