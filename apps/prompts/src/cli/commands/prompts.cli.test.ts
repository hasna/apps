import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function runCli(dbPath: string, args: string[]): CliResult {
  const proc = Bun.spawnSync(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HASNA_PROMPTS_DB_PATH: dbPath,
      PROMPTS_DB_PATH: dbPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

describe("CLI templates command", () => {
  test("respects --project scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-cli-"))
    const dbPath = join(dir, "prompts.db")

    const alphaProject = runCli(dbPath, ["--json", "project", "create", "Alpha"])
    expect(alphaProject.exitCode).toBe(0)
    const alpha = JSON.parse(alphaProject.stdout) as { id: string }

    const betaProject = runCli(dbPath, ["--json", "project", "create", "Beta"])
    expect(betaProject.exitCode).toBe(0)
    const beta = JSON.parse(betaProject.stdout) as { id: string }

    expect(runCli(dbPath, ["save", "Global Template", "--body", "Global {{name}}", "--slug", "global-template"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["--project", alpha.id, "save", "Alpha Template", "--body", "Alpha {{name}}", "--slug", "alpha-template"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["--project", beta.id, "save", "Beta Template", "--body", "Beta {{name}}", "--slug", "beta-template"]).exitCode).toBe(0)

    const templates = runCli(dbPath, ["--json", "--project", alpha.id, "templates"])
    expect(templates.exitCode).toBe(0)
    const parsed = JSON.parse(templates.stdout) as Array<{ slug: string }>
    const slugs = parsed.map((p) => p.slug)

    expect(slugs).toContain("global-template")
    expect(slugs).toContain("alpha-template")
    expect(slugs).not.toContain("beta-template")
  })
})

describe("CLI top-level scoped commands", () => {
  test("recent and trending respect --project scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-cli-scope-"))
    const dbPath = join(dir, "prompts.db")

    const alphaProject = runCli(dbPath, ["--json", "project", "create", "Alpha"]) 
    expect(alphaProject.exitCode).toBe(0)
    const alpha = JSON.parse(alphaProject.stdout) as { id: string }

    const betaProject = runCli(dbPath, ["--json", "project", "create", "Beta"])
    expect(betaProject.exitCode).toBe(0)
    const beta = JSON.parse(betaProject.stdout) as { id: string }

    expect(runCli(dbPath, ["save", "Global Prompt", "--body", "Global body", "--slug", "global-prompt"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["--project", alpha.id, "save", "Alpha Prompt", "--body", "Alpha body", "--slug", "alpha-prompt"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["--project", beta.id, "save", "Beta Prompt", "--body", "Beta body", "--slug", "beta-prompt"]).exitCode).toBe(0)

    expect(runCli(dbPath, ["use", "global-prompt"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["use", "alpha-prompt"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["use", "beta-prompt"]).exitCode).toBe(0)

    const recent = runCli(dbPath, ["--json", "--project", alpha.id, "recent", "10"])
    expect(recent.exitCode).toBe(0)
    const recentPrompts = JSON.parse(recent.stdout) as Array<{ slug: string }>
    const recentSlugs = recentPrompts.map((p) => p.slug)
    expect(recentSlugs).toContain("global-prompt")
    expect(recentSlugs).toContain("alpha-prompt")
    expect(recentSlugs).not.toContain("beta-prompt")

    const trending = runCli(dbPath, ["--json", "--project", alpha.id, "trending", "--days", "7", "--limit", "10"])
    expect(trending.exitCode).toBe(0)
    const trendingPrompts = JSON.parse(trending.stdout) as Array<{ slug: string }>
    const trendingSlugs = trendingPrompts.map((p) => p.slug)
    expect(trendingSlugs).toContain("global-prompt")
    expect(trendingSlugs).toContain("alpha-prompt")
    expect(trendingSlugs).not.toContain("beta-prompt")
  })
})

describe("CLI pagination flags", () => {
  test("list/search/templates support --offset", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-cli-pagination-"))
    const dbPath = join(dir, "prompts.db")

    expect(runCli(dbPath, ["save", "One", "--body", "common-token body one", "--slug", "one"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["save", "Two", "--body", "common-token body two", "--slug", "two"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["save", "Three", "--body", "common-token body three", "--slug", "three"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["save", "Template A", "--body", "T1 {{name}}", "--slug", "template-a"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["save", "Template B", "--body", "T2 {{name}}", "--slug", "template-b"]).exitCode).toBe(0)

    const listPage = runCli(dbPath, ["--json", "list", "--limit", "1", "--offset", "1"])
    expect(listPage.exitCode).toBe(0)
    const listRows = JSON.parse(listPage.stdout) as Array<{ slug: string }>
    expect(listRows.length).toBe(1)

    const searchPage = runCli(dbPath, ["--json", "search", "common-token", "--limit", "1", "--offset", "1"])
    expect(searchPage.exitCode).toBe(0)
    const searchRows = JSON.parse(searchPage.stdout) as Array<{ prompt: { slug: string } }>
    expect(searchRows.length).toBe(1)

    const templatesPage = runCli(dbPath, ["--json", "templates", "--limit", "1", "--offset", "1"])
    expect(templatesPage.exitCode).toBe(0)
    const templateRows = JSON.parse(templatesPage.stdout) as Array<{ slug: string }>
    expect(templateRows.length).toBe(1)
  })
})
