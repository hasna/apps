import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const cliPath = join(import.meta.dir, "..", "index.tsx")
const fixtureDir = join(import.meta.dir, "..", "..", "lib", "fixtures", "runbook-lint", "shared")

function runCli(args: string[]) {
  return Bun.spawnSync([process.execPath, "run", cliPath, ...args], {
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("prompts runbook lint CLI", () => {
  test("prints JSON findings without failing by default", () => {
    const fixtureFiles = ["alpha.md", "beta.md", "clean.md"]
    const before = fixtureFiles.map((path) => readFileSync(join(fixtureDir, path), "utf8"))
    const result = runCli(["runbook", "lint", "--dir", fixtureDir, "--detect", "boilerplate,commands,outputs", "--json"])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({
      version: 1,
      filesScanned: 3,
      detections: ["boilerplate", "commands", "outputs"],
      findings: [
        {
          kind: "boilerplate",
          files: [
            { path: "alpha.md", lines: { start: 5, end: 7 } },
            { path: "beta.md", lines: { start: 6, end: 8 } },
          ],
          excerpt: "Always inspect the working tree before acting. Never overwrite unrelated changes. Report the verification result before finishing.",
        },
        {
          kind: "commands",
          files: [
            { path: "alpha.md", lines: { start: 10, end: 13 } },
            { path: "beta.md", lines: { start: 11, end: 14 } },
          ],
          excerpt: "git status --short bun test",
        },
        {
          kind: "outputs",
          files: [
            { path: "alpha.md", lines: { start: 16, end: 21 } },
            { path: "beta.md", lines: { start: 17, end: 22 } },
          ],
          excerpt: "{ \"status\": \"ok\", \"summary\": \"string\" }",
        },
      ],
    })
    expect(fixtureFiles.map((path) => readFileSync(join(fixtureDir, path), "utf8"))).toEqual(before)
  })

  test("fails only when --fail-on-findings is explicit", () => {
    const result = runCli(["runbook", "lint", "--dir", fixtureDir, "--detect", "boilerplate,commands,outputs", "--json", "--fail-on-findings"])

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout.toString()).findings).toHaveLength(3)
  })
})
