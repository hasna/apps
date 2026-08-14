import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { analyzeRunbookPrompts, type RunbookPromptFile } from "./runbook-lint.js"

const sharedFixtureDir = join(import.meta.dir, "fixtures", "runbook-lint", "shared")

function readFixtureDirectory(directory: string): RunbookPromptFile[] {
  return readdirSync(directory)
    .sort()
    .map((path) => ({ path, content: readFileSync(join(directory, path), "utf8") }))
}

describe("runbook prompt lint analysis", () => {
  test("reports exact duplicated boilerplate, commands, and outputs", () => {
    expect(analyzeRunbookPrompts(readFixtureDirectory(sharedFixtureDir), ["boilerplate", "commands", "outputs"])).toEqual({
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
  })

  test("returns no findings for unique in-memory prompts", () => {
    const files: RunbookPromptFile[] = [
      { path: "one.md", content: "# One\n\n## SOP\nCheck the queue.\n\n## Commands\n`queue inspect`\n" },
      { path: "two.md", content: "# Two\n\n## Procedure\nCheck the cache.\n\n## Commands\n`cache inspect`\n" },
    ]

    expect(analyzeRunbookPrompts(files, ["boilerplate", "commands", "outputs"])).toEqual({
      version: 1,
      filesScanned: 2,
      detections: ["boilerplate", "commands", "outputs"],
      findings: [],
    })
  })
})
