import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")
const contractsBin = join(repoRoot, "node_modules", ".bin", "contracts")

type PackageManifest = {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
}

const pkg: PackageManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
const scripts = pkg.scripts ?? {}

function runScript(name: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync(["bun", "run", name], { cwd: repoRoot })
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  }
}

// Mirrors the unpinned-runner rule the contract kit's published_artifact_gate
// enforces: a release gate fetched from the registry at publish time is not
// reproducible and escapes the package release-age quarantine.
function unpinnedRunnerInvocations(body: string): string[] {
  const unpinned: string[] = []
  for (const segment of body.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    for (const [index, token] of tokens.entries()) {
      if (token !== "bunx" && token !== "npx") continue
      const spec = tokens.slice(index + 1).find((candidate) => !candidate.startsWith("-"))
      if (spec === undefined) continue
      if (spec.indexOf("@", spec.startsWith("@") ? 1 : 0) === -1) unpinned.push(`${token} ${spec}`)
      break
    }
  }
  return unpinned
}

describe("Hasna service contract conformance", () => {
  it("hasna.contract.json passes repo conformance with no failing check", () => {
    const result = Bun.spawnSync([contractsBin, "repo-conformance", "--json", "."], {
      cwd: repoRoot,
    })
    const stdout = result.stdout.toString()

    expect(result.exitCode, `contracts repo-conformance errored: ${result.stderr.toString()}`).toBe(
      0,
    )

    const report = JSON.parse(stdout) as {
      ok: boolean
      name: string
      class: string
      checks: { id: string; status: string; detail: string }[]
    }
    const failures = report.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.id}: ${check.detail}`)

    expect(failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.name).toBe("servers")
    expect(report.class).toBe("cli-with-store")
  })

  it("contracts:check invokes a subcommand the pinned kit actually exposes", () => {
    const { exitCode, output } = runScript("contracts:check")

    expect(output).not.toContain("unknown command")
    expect(exitCode, `contracts:check failed: ${output}`).toBe(0)
  })

  it("prepack completes, so packing and publishing are not blocked by the contract gate", () => {
    const { exitCode, output } = runScript("prepack")

    expect(output).not.toContain("missing required argument")
    expect(exitCode, `prepack failed: ${output}`).toBe(0)
    expect(output).toContain("artifact-scan")
    expect(output).toContain("no-cloud scan passed")
    // prepack rebuilds dist, packs a tarball, and scans it — well past the default timeout.
  }, 120000)

  it("prepublishOnly reaches the same packed-artifact scan as prepack", () => {
    expect(scripts["prepublishOnly"]).toContain("bun run artifact-scan")
    expect(scripts["prepack"]).toContain("bun run artifact-scan")
  })

  it("the contract kit is an exact devDependency, not resolved from the registry at publish time", () => {
    const pinned = pkg.devDependencies?.["@hasna/contracts"]

    expect(pinned).toBeDefined()
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)

    const unpinned = Object.entries(scripts).flatMap(([name, body]) =>
      unpinnedRunnerInvocations(body).map((invocation) => `${name}: ${invocation}`),
    )
    expect(unpinned).toEqual([])
  })

  it("the declared kitVersion tracks the installed contract kit", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "hasna.contract.json"), "utf8")) as {
      kitVersion: string
    }
    const installed = JSON.parse(
      readFileSync(join(repoRoot, "node_modules", "@hasna", "contracts", "package.json"), "utf8"),
    ) as { version: string }

    expect(manifest.kitVersion).toBe(installed.version)
  })
})
