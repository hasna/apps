import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runRepoConformance } from "@hasna/contracts/conformance"

const repoRoot = join(import.meta.dir, "..")
const registerPath = "docs/contracts-conformance.md"

/**
 * `bun run contracts:check` exits 1 on four structural gates that no manifest edit can
 * close (see docs/contracts-conformance.md). A red script nothing looks at is how a repo
 * quietly records itself as conformant, so these tests hold the documented gap register to
 * the checker's real output in both directions.
 */
const report = runRepoConformance(repoRoot)
const register = readFileSync(join(repoRoot, registerPath), "utf8")

/** Check ids listed in the first column of the register's "Open conformance gates" table. */
function documentedOpenGates(markdown: string): string[] {
  const section = markdown.split(/^## /m).find((block) => block.startsWith("Open conformance gates"))
  if (!section) return []
  return [...section.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)].map((match) => match[1]!)
}

function idsWithStatus(status: string): string[] {
  return report.checks.filter((check) => check.status === status).map((check) => check.id).sort()
}

describe("contracts conformance register", () => {
  test("the register lists every open gate and nothing else", () => {
    const documented = documentedOpenGates(register).sort()

    expect(documented).not.toEqual([])
    expect(idsWithStatus("fail")).toEqual(documented)
  })

  test("no check outside the register is failing", () => {
    const documented = new Set(documentedOpenGates(register))
    const undocumented = report.checks
      .filter((check) => check.status === "fail" && !documented.has(check.id))
      .map((check) => `${check.id}: ${check.detail}`)

    // A new failure must be fixed or documented; it must not ride along silently.
    expect(undocumented).toEqual([])
  })

  test("the checks the register claims pass today really pass", () => {
    const passing = idsWithStatus("pass")

    for (const id of [
      "manifest_valid",
      "bins_allowlisted",
      "bins_match_package",
      "surface_bindings",
      "public_manifest_safety",
      "hosting_story",
      "mode_enum_compliance",
      "published_artifact_gate",
      "credential_seam_compliance",
      "no_cloud_guard",
    ]) {
      expect(passing).toContain(id)
    }
  })

  test("the register points at a tracked follow-up", () => {
    expect(register).toMatch(/todos task `[0-9a-f-]{36}`/)
  })

  test("the register does not claim the repo is conformant", () => {
    expect(report.ok).toBe(false)
    expect(register).toContain("`bun run contracts:check` currently exits 1")
  })
})
