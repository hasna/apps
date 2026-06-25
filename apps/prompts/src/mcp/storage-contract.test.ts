import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("storage MCP contract", () => {
  test("registers storage tools instead of cloud-named public tools", () => {
    const toolsSource = readFileSync(join(process.cwd(), "src/mcp/storage-tools.ts"), "utf8")
    const indexSource = readFileSync(join(process.cwd(), "src/mcp/index.ts"), "utf8")

    expect(toolsSource).toContain("export function registerPromptsStorageTools")
    expect(indexSource).toContain("registerPromptsStorageTools(server)")
    expect(toolsSource).toContain('"prompts_storage_status"')
    expect(toolsSource).toContain('"prompts_storage_push"')
    expect(toolsSource).toContain('"prompts_storage_pull"')
    expect(toolsSource).toContain('"prompts_storage_sync"')
    expect(toolsSource).toContain('"prompts_storage_feedback"')
  })
})
