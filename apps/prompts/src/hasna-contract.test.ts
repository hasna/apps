import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateServiceContractManifest } from "@hasna/contracts/service-contract"

const repoRoot = join(import.meta.dir, "..")

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as T
}

interface PackageManifest {
  scripts: Record<string, string>
}

interface ServiceContractShape {
  metadata?: { release?: { artifactScan?: { script?: string } } }
}

/**
 * Resolve which package scripts `entry` reaches through `bun run <name>` chains,
 * mirroring how the contracts kit walks the prepack script graph.
 */
function reachableScripts(scripts: Record<string, string>, entry: string): Set<string> {
  const reached = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (reached.has(name)) continue
    reached.add(name)
    const body = scripts[name]
    if (!body) continue
    for (const match of body.matchAll(/\b(?:bun|bunx|npm)\s+run\s+([\w:.-]+)/g)) {
      if (match[1] && match[1] in scripts) queue.push(match[1])
    }
  }
  return reached
}

describe("hasna.contract.json", () => {
  test("validates against hasna.service_contract.v1", () => {
    const result = validateServiceContractManifest(readJson("hasna.contract.json"))
    const issues = result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
    expect(issues).toEqual([])
  })

  test("declares the packed-artifact scan the release gate requires", () => {
    const manifest = readJson<ServiceContractShape>("hasna.contract.json")
    const { scripts } = readJson<PackageManifest>("package.json")
    const declared = manifest.metadata?.release?.artifactScan?.script

    expect(declared).toBeString()
    expect(scripts).toHaveProperty(declared!)
    // A gate the release path never reaches is the bypass the clause exists to close.
    expect([...reachableScripts(scripts, "prepack")]).toContain(declared!)
    // An unpinned runner makes the gate non-reproducible.
    expect(scripts[declared!]).not.toMatch(/\b(?:bunx|npx)\b/)
  })
})

describe("contract package scripts", () => {
  const { scripts } = readJson<PackageManifest>("package.json")

  test("every script runs without a missing required argument or unknown subcommand", () => {
    // `contracts artifact-scan` takes a mandatory packed-artifact target and
    // `contracts check` does not exist, so neither bare form can ever exit 0.
    const broken = Object.entries(scripts).filter(([, body]) =>
      /@hasna\/contracts(?:@[^\s]+)?\s+(?:artifact-scan\s*$|check\b)/.test(body),
    )
    expect(broken).toEqual([])
  })

  test("contracts:check runs the real repo conformance subcommand, version-pinned", () => {
    expect(scripts["contracts:check"]).toContain("repo-conformance")
    expect(scripts["contracts:check"]).toMatch(/@hasna\/contracts@\d+\.\d+\.\d+/)
  })

  test("prepack still reaches the no-cloud packed-artifact guard", () => {
    const reached = reachableScripts(scripts, "prepack")
    const guards = [...reached].filter((name) =>
      scripts[name]?.includes("scripts/no-cloud-artifact-scan.mjs"),
    )
    expect(guards.length).toBeGreaterThan(0)
  })
})
