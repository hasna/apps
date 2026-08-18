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

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

describe("CLI templates command", () => {
  test("respects --project scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-cli-"))
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

describe("CLI compact output defaults", () => {
  test("list caps human output and keeps JSON full records explicit", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-cli-compact-"))
    const dbPath = join(dir, "prompts.db")

    for (let i = 1; i <= 25; i++) {
      const title = `Prompt ${String(i).padStart(2, "0")} with a deliberately long title that should not flood terminals`
      const body = `body ${i} ${"x".repeat(220)} unique-${i}`
      const result = runCli(dbPath, ["save", title, "--body", body, "--slug", `compact-${i}`, "--tags", "alpha,beta,gamma,delta", "--force"])
      expect(result.exitCode).toBe(0)
    }

    const list = runCli(dbPath, ["list"])
    expect(list.exitCode).toBe(0)
    const stdout = stripAnsi(list.stdout)
    expect(stdout.match(/prmt-/g)?.length).toBe(20)
    expect(stdout).toContain("Showing 20 prompt(s). Next: --offset 20")
    expect(stdout).toContain("Use --verbose for more metadata")
    expect(stdout).toContain("prompts show <id>")

    const jsonList = runCli(dbPath, ["--json", "list", "--limit", "1"])
    expect(jsonList.exitCode).toBe(0)
    const parsed = JSON.parse(jsonList.stdout) as Array<{ body?: string; slug: string }>
    expect(parsed.length).toBe(1)
    expect(parsed[0]?.body).toContain("unique-")
  })

  test("show is compact by default and verbose discloses the full body", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-cli-show-"))
    const dbPath = join(dir, "prompts.db")
    const longBody = `start ${"x".repeat(220)} UNIQUE_VERBOSE_TAIL`

    expect(runCli(dbPath, ["save", "Detail Prompt", "--body", longBody, "--slug", "detail-prompt"]).exitCode).toBe(0)

    const compact = runCli(dbPath, ["show", "detail-prompt"])
    expect(compact.exitCode).toBe(0)
    const compactOut = stripAnsi(compact.stdout)
    expect(compactOut).toContain("Body chars:")
    expect(compactOut).toContain("Use --verbose for the full body")
    expect(compactOut).not.toContain("UNIQUE_VERBOSE_TAIL")

    const verbose = runCli(dbPath, ["show", "detail-prompt", "--verbose"])
    expect(verbose.exitCode).toBe(0)
    expect(stripAnsi(verbose.stdout)).toContain("UNIQUE_VERBOSE_TAIL")
  })

  test("lint exits nonzero when errors are beyond the displayed page", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-cli-lint-"))
    const dbPath = join(dir, "prompts.db")

    expect(runCli(dbPath, ["save", "Hidden Error", "--body", "tiny", "--slug", "hidden-error"]).exitCode).toBe(0)
    for (let i = 1; i <= 20; i++) {
      expect(runCli(dbPath, ["save", `Warning ${i}`, "--body", `long enough body ${i}`, "--slug", `warning-${i}`]).exitCode).toBe(0)
    }

    const lint = runCli(dbPath, ["lint"])
    expect(lint.exitCode).toBe(1)
    const stdout = stripAnsi(lint.stdout)
    expect(stdout).toContain("Showing 20 of 21 prompt(s) with issues")
    expect(stdout).toContain("1 errors")
    expect(stdout).toContain("Use --limit 21 or --json")
  })

  test("recent supports offset pagination when it prints a next hint", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-cli-recent-page-"))
    const dbPath = join(dir, "prompts.db")

    for (let i = 1; i <= 11; i++) {
      const slug = `recent-${i}`
      expect(runCli(dbPath, ["save", `Recent ${i}`, "--body", `recent body ${i}`, "--slug", slug]).exitCode).toBe(0)
      expect(runCli(dbPath, ["use", slug]).exitCode).toBe(0)
    }

    const firstPage = runCli(dbPath, ["recent", "10"])
    expect(firstPage.exitCode).toBe(0)
    expect(stripAnsi(firstPage.stdout)).toContain("Next: --offset 10")

    const secondPage = runCli(dbPath, ["recent", "10", "--offset", "10"])
    expect(secondPage.exitCode).toBe(0)
    expect(stripAnsi(secondPage.stdout).match(/prmt-/g)?.length).toBe(1)
  })
})

describe("CLI top-level scoped commands", () => {
  test("recent and trending respect --project scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-cli-scope-"))
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
    const dir = mkdtempSync(join(tmpdir(), "prompts-cli-pagination-"))
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

describe("CLI render strict/typed/preview", () => {
  test("strict render fails with named error on missing required var", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-render-"))
    const dbPath = join(dir, "prompts.db")
    expect(runCli(dbPath, ["save", "Strict Tpl", "--body", "Hello {{name}}", "--slug", "strict-tpl"]).exitCode).toBe(0)
    const result = runCli(dbPath, ["--json", "render", "strict-tpl", "--strict"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("MISSING_VARIABLE")
  })

  test("non-strict render leaves placeholder and reports missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-render-"))
    const dbPath = join(dir, "prompts.db")
    expect(runCli(dbPath, ["save", "Strict Tpl", "--body", "Hello {{name}}", "--slug", "strict-tpl"]).exitCode).toBe(0)
    const result = runCli(dbPath, ["--json", "render", "strict-tpl"])
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as { rendered: string; missing_vars: string[] }
    expect(parsed.rendered).toContain("{{name}}")
    expect(parsed.missing_vars).toContain("name")
  })

  test("preview render emits visible markers", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-render-"))
    const dbPath = join(dir, "prompts.db")
    expect(runCli(dbPath, ["save", "Preview Tpl", "--body", "Hello {{name}}", "--slug", "preview-tpl"]).exitCode).toBe(0)
    const result = runCli(dbPath, ["--json", "render", "preview-tpl", "--preview"])
    const parsed = JSON.parse(result.stdout) as { rendered: string }
    expect(parsed.rendered).toBe("Hello [UNRESOLVED kind:var name=name]")
  })

  test("vars-json renders typed values", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-render-"))
    const dbPath = join(dir, "prompts.db")
    expect(runCli(dbPath, ["save", "Typed Tpl", "--body", "Count {{count}}", "--slug", "typed-tpl"]).exitCode).toBe(0)
    const result = runCli(dbPath, ["--json", "render", "typed-tpl", "--vars-json", '{"count": 42}'])
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as { rendered: string }
    expect(parsed.rendered).toBe("Count 42")
  })
})

describe("CLI labels", () => {
  test("label --set, labels, and list --label filter", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-labels-"))
    const dbPath = join(dir, "prompts.db")
    expect(runCli(dbPath, ["save", "Labeled A", "--body", "body a", "--slug", "labeled-a"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["save", "Labeled B", "--body", "body b", "--slug", "labeled-b"]).exitCode).toBe(0)

    expect(runCli(dbPath, ["label", "labeled-a", "--set", "environment=Production", "--set", "team=Core"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["label", "labeled-b", "--set", "environment=Staging"]).exitCode).toBe(0)

    const labels = runCli(dbPath, ["--json", "labels", "labeled-a"])
    expect(labels.exitCode).toBe(0)
    const parsedLabels = JSON.parse(labels.stdout) as Array<{ key: string; value: string }>
    expect(parsedLabels).toHaveLength(2)
    expect(parsedLabels[0]?.key).toBe("environment")
    expect(parsedLabels[0]?.value).toBe("production") // normalized

    const filtered = runCli(dbPath, ["--json", "list", "--label", "environment=production"])
    expect(filtered.exitCode).toBe(0)
    const rows = JSON.parse(filtered.stdout) as Array<{ slug: string }>
    expect(rows.map((r) => r.slug)).toEqual(["labeled-a"])

    // Remove and re-filter
    expect(runCli(dbPath, ["label", "labeled-a", "--remove", "environment"]).exitCode).toBe(0)
    const after = runCli(dbPath, ["--json", "list", "--label", "environment=production"])
    expect(JSON.parse(after.stdout) as unknown[]).toEqual([])
  })

  test("save --label persists labels and search --label filters", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-labels-"))
    const dbPath = join(dir, "prompts.db")
    expect(runCli(dbPath, ["save", "Searchable X", "--body", "unique searchable body", "--slug", "searchable-x", "--label", "env=prod"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["save", "Searchable Y", "--body", "unique searchable body", "--slug", "searchable-y"]).exitCode).toBe(0)

    const results = runCli(dbPath, ["--json", "search", "searchable", "--label", "env=prod"])
    expect(results.exitCode).toBe(0)
    const rows = JSON.parse(results.stdout) as Array<{ prompt: { slug: string } }>
    expect(rows.map((r) => r.prompt.slug)).toEqual(["searchable-x"])
  })
})

describe("CLI var-schema and extends", () => {
  test("save --var-schema persists typed defaults and render uses them", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-schema-"))
    const dbPath = join(dir, "prompts.db")
    const schema = JSON.stringify([{ name: "count", type: "number", default: 5, description: "the count" }])
    expect(runCli(dbPath, ["save", "Schema Tpl", "--body", "Count {{count}}", "--slug", "schema-tpl", "--var-schema", schema]).exitCode).toBe(0)

    const inspect = runCli(dbPath, ["--json", "inspect", "schema-tpl"])
    expect(inspect.exitCode).toBe(0)
    const vars = JSON.parse(inspect.stdout) as Array<{ name: string; typed_default: unknown; type: string }>
    expect(vars[0]?.name).toBe("count")
    expect(vars[0]?.typed_default).toBe(5)
    expect(vars[0]?.type).toBe("number")

    const rendered = runCli(dbPath, ["--json", "render", "schema-tpl"])
    const parsed = JSON.parse(rendered.stdout) as { rendered: string }
    expect(parsed.rendered).toBe("Count 5")
  })

  test("save --extends composes parent body at render time", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-extends-"))
    const dbPath = join(dir, "prompts.db")
    expect(runCli(dbPath, ["save", "Parent", "--body", "PARENT {{name|p}}", "--slug", "parent-tpl"]).exitCode).toBe(0)
    expect(runCli(dbPath, ["save", "Child", "--body", "CHILD", "--slug", "child-tpl", "--extends", "parent-tpl"]).exitCode).toBe(0)

    const rendered = runCli(dbPath, ["--json", "render", "child-tpl"])
    expect(rendered.exitCode).toBe(0)
    const parsed = JSON.parse(rendered.stdout) as { rendered: string; resolved_sources: Array<{ relation: string }> }
    expect(parsed.rendered).toBe("PARENT p\n\nCHILD")
    expect(parsed.resolved_sources.map((s) => s.relation)).toEqual(["self", "parent"])
  })
})
