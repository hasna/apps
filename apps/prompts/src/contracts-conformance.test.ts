import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runRepoConformance } from "@hasna/contracts/conformance"

const repoRoot = join(import.meta.dir, "..")
const registerPath = "docs/contracts-conformance.md"

/**
 * `bun run contracts:check` exits 1 on any structural gate that a manifest edit
 * cannot close, and 0 once every gate passes. This test holds the documented
 * conformance state to the checker's real output in both directions.
 */
const report = runRepoConformance(repoRoot)
const register = readFileSync(join(repoRoot, registerPath), "utf8")

function idsWithStatus(status: string): string[] {
  return report.checks.filter((check) => check.status === status).map((check) => check.id).sort()
}

describe("contracts conformance register", () => {
  test("every conformance gate passes", () => {
    const failing = idsWithStatus("fail")
    expect(failing).toEqual([])
  })

  test("no undocumented failure can ride along silently", () => {
    const undocumented = report.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.id}: ${check.detail}`)
    expect(undocumented).toEqual([])
  })

  test("the gates the storage-core patch closes stay closed", () => {
    const passing = idsWithStatus("pass")

    for (const id of [
      "manifest_valid",
      "bins_allowlisted",
      "bins_match_package",
      "surface_bindings",
      "surface_matrix",
      "service_api_topology",
      "self_host_artifact",
      "storage_capabilities",
      "public_manifest_safety",
      "hosting_story",
      "server_backend_configuration",
      "published_artifact_gate",
      "credential_seam_compliance",
      "no_cloud_guard",
    ]) {
      expect(passing).toContain(id)
    }
  })

  test("the register states the green state honestly", () => {
    expect(report.ok).toBe(true)
    expect(register).toContain("`bun run contracts:check` currently exits 0")
  })
})
