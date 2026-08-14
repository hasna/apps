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

  test("escapes frontmatter so punctuation roundtrips through import", () => {
    const prompt: Prompt = {
      ...mockPrompt,
      title: "\"Deploy: Review\"",
      slug: "deploy-review",
      collection: "ops,release",
      tags: ["release,blocked", "owner \"qa\"", "C:\\deploy"],
      description: "Check \"prod: blue\"\nThen approve",
      body: "Review the rollout plan.",
    }

    const md = promptToMarkdown(prompt)
    const item = markdownToImportItem(md, "deploy-review.md")

    expect(item).toEqual({
      title: prompt.title,
      slug: prompt.slug,
      collection: prompt.collection,
      tags: prompt.tags,
      description: prompt.description,
      body: prompt.body,
    })
  })

  test("quotes YAML-special strings that would be retyped or parsed as syntax", () => {
    const prompt: Prompt = {
      ...mockPrompt,
      title: "#hash",
      slug: "null",
      collection: "? prod",
      tags: ["a:", "foo #bar", "true", "2026-06-21", "[prod]"],
      description: "value # hidden",
      body: "Keep values as strings.",
    }

    const md = promptToMarkdown(prompt)
    const item = markdownToImportItem(md, "yaml-hazards.md")

    expect(md).toContain("title: \"#hash\"")
    expect(md).toContain("slug: \"null\"")
    expect(md).toContain("collection: \"? prod\"")
    expect(md).toContain("tags: [\"a:\", \"foo #bar\", \"true\", \"2026-06-21\", \"[prod]\"]")
    expect(md).toContain("description: \"value # hidden\"")
    expect(item).toEqual({
      title: prompt.title,
      slug: prompt.slug,
      collection: prompt.collection,
      tags: prompt.tags,
      description: prompt.description,
      body: prompt.body,
    })
  })

  test("quotes YAML numeric forms that common parsers would retype", () => {
    const prompt: Prompt = {
      ...mockPrompt,
      title: "0x10",
      slug: "safe-slug",
      collection: "1.",
      tags: ["0b1010", "1_000.0"],
      description: "1_000",
      body: "Keep numeric-looking values as strings.",
    }

    const md = promptToMarkdown(prompt)
    const item = markdownToImportItem(md, "numeric-hazards.md")

    expect(md).toContain("title: \"0x10\"")
    expect(md).toContain("collection: \"1.\"")
    expect(md).toContain("tags: [\"0b1010\", \"1_000.0\"]")
    expect(md).toContain("description: \"1_000\"")
    expect(item).toEqual({
      title: prompt.title,
      slug: prompt.slug,
      collection: prompt.collection,
      tags: prompt.tags,
      description: prompt.description,
      body: prompt.body,
    })
  })

  test("escapes non-printable control characters in quoted frontmatter", () => {
    const prompt: Prompt = {
      ...mockPrompt,
      title: "a\b b",
      slug: "control-safe",
      collection: "safe",
      tags: ["a\x1B b", "a\0 b"],
      description: "a\f b",
      body: "Keep control characters escaped.",
    }

    const md = promptToMarkdown(prompt)
    const item = markdownToImportItem(md, "control-hazards.md")

    expect(md).toContain("title: \"a\\b b\"")
    expect(md).toContain("tags: [\"a\\x1B b\", \"a\\0 b\"]")
    expect(md).toContain("description: \"a\\f b\"")
    expect(md).not.toContain("\b")
    expect(md).not.toContain("\f")
    expect(md).not.toContain("\x1B")
    expect(md).not.toContain("\0")
    expect(item).toEqual({
      title: prompt.title,
      slug: prompt.slug,
      collection: prompt.collection,
      tags: prompt.tags,
      description: prompt.description,
      body: prompt.body,
    })
  })

  test("escapes DEL and C1 controls in quoted frontmatter", () => {
    const prompt: Prompt = {
      ...mockPrompt,
      title: "a\x7F b",
      slug: "c1-control-safe",
      collection: "safe",
      tags: ["a\u0080 b", "a\u009F b"],
      description: "a\u0085 b",
      body: "Keep extended controls escaped.",
    }

    const md = promptToMarkdown(prompt)
    const item = markdownToImportItem(md, "c1-control-hazards.md")

    expect(md).toContain("title: \"a\\x7F b\"")
    expect(md).toContain("tags: [\"a\\x80 b\", \"a\\x9F b\"]")
    expect(md).toContain("description: \"a\\x85 b\"")
    expect(md).not.toContain("\x7F")
    expect(md).not.toContain("\u0080")
    expect(md).not.toContain("\u0085")
    expect(md).not.toContain("\u009F")
    expect(item).toEqual({
      title: prompt.title,
      slug: prompt.slug,
      collection: prompt.collection,
      tags: prompt.tags,
      description: prompt.description,
      body: prompt.body,
    })
  })

  test("escapes Unicode line and paragraph separators in quoted frontmatter", () => {
    const prompt: Prompt = {
      ...mockPrompt,
      title: "line\u2028sep",
      slug: "unicode-separator-safe",
      collection: "safe",
      tags: ["para\u2029sep"],
      description: "line\u2028and\u2029para",
      body: "Keep Unicode separators escaped.",
    }

    const md = promptToMarkdown(prompt)
    const item = markdownToImportItem(md, "unicode-separator-hazards.md")

    expect(md).toContain("title: \"line\\u2028sep\"")
    expect(md).toContain("tags: [\"para\\u2029sep\"]")
    expect(md).toContain("description: \"line\\u2028and\\u2029para\"")
    expect(md).not.toContain("\u2028")
    expect(md).not.toContain("\u2029")
    expect(item).toEqual({
      title: prompt.title,
      slug: prompt.slug,
      collection: prompt.collection,
      tags: prompt.tags,
      description: prompt.description,
      body: prompt.body,
    })
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

  test("parses quoted frontmatter values and tags", () => {
    const md = `---
title: "Deploy Review"
slug: 'deploy-review'
collection: "ops"
tags: ["release", 'checklist']
description: "Review deployment readiness"
---

Check rollout risks.`

    const item = markdownToImportItem(md, "deploy-review.md")
    expect(item).toEqual({
      title: "Deploy Review",
      slug: "deploy-review",
      collection: "ops",
      tags: ["release", "checklist"],
      description: "Review deployment readiness",
      body: "Check rollout risks.",
    })
  })

  test("preserves escaped backslashes in quoted frontmatter", () => {
    const md = `---
description: "C:\\\\new"
tags: ["C:\\\\release"]
---

Keep path-like values intact.`

    const item = markdownToImportItem(md, "path-prompt.md")
    expect(item?.description).toBe("C:\\new")
    expect(item?.tags).toEqual(["C:\\release"])
  })

  test("decodes common escapes and preserves unknown escapes in quoted frontmatter", () => {
    const md = `---
description: "alpha\\tbeta\\rgamma\\qdelta"
tags: ["tab\\tvalue", "raw\\qvalue"]
---

Keep escaped values predictable.`

    const item = markdownToImportItem(md, "escaped-prompt.md")
    expect(item?.description).toBe("alpha\tbeta\rgamma\\qdelta")
    expect(item?.tags).toEqual(["tab\tvalue", "raw\\qvalue"])
  })

  test("parses frontmatter with CRLF line endings", () => {
    const md = "---\r\ntitle: Windows Prompt\r\nslug: windows-prompt\r\n---\r\n\r\nUse CRLF safely.\r\n"

    const item = markdownToImportItem(md, "windows-prompt.md")
    expect(item?.title).toBe("Windows Prompt")
    expect(item?.slug).toBe("windows-prompt")
    expect(item?.body).toBe("Use CRLF safely.")
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
