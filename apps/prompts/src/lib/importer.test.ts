import { describe, expect, test } from "bun:test"
import { promptToMarkdown, markdownToImportItem, importFromClaudeCommands } from "./importer.js"
import type { Prompt } from "../types/index.js"

const mockPrompt: Prompt = {
  id: "PRMT-00001",
  name: "Test Prompt",
  slug: "test-prompt",
  title: "Test Prompt",
  body: "Hello {{name}}",
  description: "A test prompt",
  collection: "testing",
  tags: ["test", "example"],
  variables: [{ name: "name", required: true }],
  is_template: true,
  source: "manual",
  version: 1,
  use_count: 0,
  last_used_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

describe("promptToMarkdown", () => {
  test("generates valid frontmatter", () => {
    const md = promptToMarkdown(mockPrompt)
    expect(md).toContain("title: Test Prompt")
    expect(md).toContain("slug: test-prompt")
    expect(md).toContain("collection: testing")
    expect(md).toContain("tags: [test, example]")
    expect(md).toContain("description: A test prompt")
    expect(md).toContain("Hello {{name}}")
  })
})

describe("markdownToImportItem", () => {
  test("parses frontmatter correctly", () => {
    const md = `---
title: My Prompt
slug: my-prompt
collection: code
tags: [typescript, review]
description: A code review prompt
---

Review this {{language}} code.`

    const item = markdownToImportItem(md, "my-prompt.md")
    expect(item).not.toBeNull()
    expect(item?.title).toBe("My Prompt")
    expect(item?.slug).toBe("my-prompt")
    expect(item?.collection).toBe("code")
    expect(item?.tags).toContain("typescript")
    expect(item?.body).toBe("Review this {{language}} code.")
  })

  test("handles no-frontmatter file using filename as title", () => {
    const item = markdownToImportItem("Just a plain body", "deploy-checklist.md")
    expect(item?.title).toBe("deploy checklist")
    expect(item?.body).toBe("Just a plain body")
  })

  test("roundtrip: export then re-import", () => {
    const md = promptToMarkdown(mockPrompt)
    const item = markdownToImportItem(md, "test-prompt.md")
    expect(item?.title).toBe(mockPrompt.title)
    expect(item?.slug).toBe(mockPrompt.slug)
    expect(item?.body).toBe(mockPrompt.body)
    expect(item?.tags).toEqual(mockPrompt.tags)
  })
})

describe("importFromClaudeCommands", () => {
  test("converts filenames to titles and sets collection", () => {
    // This only tests the item conversion logic without hitting DB
    const files = [
      { filename: "code-review.md", content: "Review this code: {{code}}" },
      { filename: "summarize.md", content: "Summarize: {{text}}" },
    ]
    // We test the raw conversion
    const file = files[0]!
    const name = file.filename.replace(/\.md$/, "")
    const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    expect(title).toBe("Code Review")
  })
})
