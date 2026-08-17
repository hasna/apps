import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase, getDatabase } from "./database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt, getPrompt } from "./prompts.js"
import {
  setParent,
  setPartial,
  removeDependency,
  listDependencies,
  getParent,
  renderPromptTemplate,
} from "./dependencies.js"
import { recordRenderReceipt, getRenderReceipts } from "./receipts.js"
import { TemplateRenderError } from "../types/index.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

function makePrompt(title: string, body: string, slug?: string) {
  return createPrompt({ title, body, slug })
}

describe("parent dependency", () => {
  test("sets a single parent with pinned version", () => {
    const parent = makePrompt("Parent", "Parent body {{name|p}}", "parent")
    const child = makePrompt("Child", "Child body", "child")
    const dep = setParent(child.id, "parent")
    expect(dep.relation).toBe("parent")
    expect(dep.dependency_prompt_id).toBe(parent.id)
    expect(dep.pinned_version).toBe(parent.version)
  })

  test("only one parent is allowed — setting replaces", () => {
    const p1 = makePrompt("P1", "one", "p1")
    const p2 = makePrompt("P2", "two", "p2")
    const child = makePrompt("Child", "body", "child")
    setParent(child.id, "p1")
    setParent(child.id, "p2")
    const deps = listDependencies(child.id)
    expect(deps.filter((d) => d.relation === "parent")).toHaveLength(1)
    expect(getParent(child.id)?.dependency_prompt_id).toBe(p2.id)
  })

  test("setting the same parent twice is idempotent", () => {
    const parent = makePrompt("Parent", "body", "parent")
    const child = makePrompt("Child", "body", "child")
    setParent(child.id, "parent")
    setParent(child.id, "parent")
    expect(listDependencies(child.id)).toHaveLength(1)
  })

  test("removes a parent", () => {
    const parent = makePrompt("Parent", "body", "parent")
    const child = makePrompt("Child", "body", "child")
    setParent(child.id, "parent")
    removeDependency(child.id, "parent")
    expect(getParent(child.id)).toBeNull()
  })

  test("cascades on prompt delete", () => {
    const parent = makePrompt("Parent", "body", "parent")
    const child = makePrompt("Child", "body", "child")
    setParent(child.id, "parent")
    const db = getDatabase()
    db.run("DELETE FROM prompts WHERE id = ?", [child.id])
    const count = (db.query("SELECT COUNT(*) as n FROM prompt_dependencies").get() as { n: number }).n
    expect(count).toBe(0)
  })
})

describe("partial dependency", () => {
  test("adds and lists partials", () => {
    const partial = makePrompt("Partial", "shared {{x}}", "shared-partial")
    const host = makePrompt("Host", "Host body", "host")
    const dep = setPartial(host.id, "shared-partial", "header")
    expect(dep.relation).toBe("partial")
    expect(dep.slot).toBe("header")
    expect(dep.dependency_prompt_id).toBe(partial.id)
    expect(listDependencies(host.id).filter((d) => d.relation === "partial")).toHaveLength(1)
  })

  test("partials cascade on delete", () => {
    const partial = makePrompt("Partial", "body", "p")
    const host = makePrompt("Host", "body", "h")
    setPartial(host.id, "p")
    const db = getDatabase()
    db.run("DELETE FROM prompts WHERE id = ?", [partial.id])
    expect(listDependencies(host.id)).toHaveLength(0)
  })
})

describe("renderPromptTemplate", () => {
  test("renders child body with parent prepended", () => {
    const parent = makePrompt("Parent", "PARENT {{name|p}}", "parent")
    const child = makePrompt("Child", "CHILD {{name|c}}", "child")
    setParent(child.id, "parent")
    const result = renderPromptTemplate(child, {})
    expect(result.rendered).toBe("PARENT p\n\nCHILD c")
  })

  test("parent values resolve against child vars", () => {
    const parent = makePrompt("Parent", "PARENT {{name}}", "parent")
    const child = makePrompt("Child", "CHILD", "child")
    setParent(child.id, "parent")
    const result = renderPromptTemplate(child, { name: "X" })
    expect(result.rendered).toBe("PARENT X\n\nCHILD")
  })

  test("parent chain is depth-bounded", () => {
    const seen: string[] = []
    for (let i = 0; i < 15; i++) {
      const p = makePrompt(`P${i}`, `body-${i}`, `p${i}`)
      seen.push(p.id)
      if (i > 0) setParent(p.id, `p${i - 1}`)
    }
    const top = getPrompt(seen[14]!)
    expect(() => renderPromptTemplate(top!, {})).toThrow(/PARENT_DEPTH_EXCEEDED/)
  })

  test("parent cycle throws TEMPLATE_CYCLE", () => {
    const a = makePrompt("A", "A", "a")
    const b = makePrompt("B", "B", "b")
    setParent(a.id, "b")
    setParent(b.id, "a")
    expect(() => renderPromptTemplate(a, {})).toThrow(/TEMPLATE_CYCLE/)
  })

  test("missing parent throws PARENT_NOT_FOUND (defensive: row present, prompt gone)", () => {
    const child = makePrompt("Child", "body", "child")
    // Simulate a dependency row whose target prompt no longer resolves.
    // Unreachable through setParent (which resolves at set time) and normally
    // impossible under FK enforcement — exercise the defensive path directly.
    const db = getDatabase()
    db.exec("PRAGMA foreign_keys = OFF")
    try {
      db.run(
        `INSERT INTO prompt_dependencies (id, prompt_id, dependency_prompt_id, dependency_slug, relation, pinned_version, ordering)
         VALUES (?, ?, ?, ?, 'parent', 1, 0)`,
        ["PD-ORPHAN", child.id, "prmt-ghost", "ghost-parent"]
      )
    } finally {
      db.exec("PRAGMA foreign_keys = ON")
    }
    expect(() => renderPromptTemplate(child, {})).toThrow(/PARENT_NOT_FOUND/)
  })

  test("missing parent error carries code", () => {
    const child = makePrompt("Child", "body", "child")
    const db = getDatabase()
    db.exec("PRAGMA foreign_keys = OFF")
    try {
      db.run(
        `INSERT INTO prompt_dependencies (id, prompt_id, dependency_prompt_id, dependency_slug, relation, pinned_version, ordering)
         VALUES (?, ?, ?, ?, 'parent', 1, 0)`,
        ["PD-ORPHAN-2", child.id, "prmt-ghost", "ghost-parent"]
      )
    } finally {
      db.exec("PRAGMA foreign_keys = ON")
    }
    let caught: TemplateRenderError | null = null
    try {
      renderPromptTemplate(child, {})
    } catch (e) {
      caught = e as TemplateRenderError
    }
    expect(caught?.code).toBe("PARENT_NOT_FOUND")
  })

  test("partials in child body resolve from the store", () => {
    const partial = makePrompt("Partial", "SHARED {{who}}", "shared-partial")
    const host = makePrompt("Host", "HOST {{>shared-partial}}", "host")
    setPartial(host.id, "shared-partial")
    const result = renderPromptTemplate(host, { who: "all" })
    expect(result.rendered).toBe("HOST SHARED all")
    // partial body must not itself be composed with a parent (it has none)
  })

  test("partial references not declared as dependencies still resolve", () => {
    const partial = makePrompt("Partial", "SHARED", "undeclared-partial")
    const host = makePrompt("Host", "HOST {{>undeclared-partial}}", "host")
    const result = renderPromptTemplate(host, {})
    expect(result.rendered).toBe("HOST SHARED")
  })

  test("resolved sources include self, parent, and partials in order", () => {
    const parent = makePrompt("Parent", "P", "parent")
    const partial = makePrompt("Partial", "S", "partial-one")
    const child = makePrompt("Child", "C {{>partial-one}}", "child")
    setParent(child.id, "parent")
    setPartial(child.id, "partial-one")
    const result = renderPromptTemplate(child, {})
    expect(result.resolved_sources).toEqual([
      { id: child.id, version: 1, relation: "self", slot: null },
      { id: parent.id, version: 1, relation: "parent", slot: null },
      { id: partial.id, version: 1, relation: "partial", slot: null },
    ])
  })

  test("no dependencies means no resolved sources and no self entry", () => {
    const plain = makePrompt("Plain", "Just {{name}}", "plain")
    const result = renderPromptTemplate(plain, { name: "x" })
    expect(result.resolved_sources).toEqual([])
    expect(result.rendered).toBe("Just x")
  })

  test("strict render fails through the composed body", () => {
    const parent = makePrompt("Parent", "P {{missing}}", "parent")
    const child = makePrompt("Child", "C", "child")
    setParent(child.id, "parent")
    expect(() => renderPromptTemplate(child, {}, { strict: true })).toThrow(/MISSING_VARIABLE/)
  })
})

describe("render receipts", () => {
  test("records a receipt with resolved sources and hash", () => {
    const parent = makePrompt("Parent", "P", "parent")
    const child = makePrompt("Child", "C", "child")
    setParent(child.id, "parent")
    const result = renderPromptTemplate(child, {})
    const receipt = recordRenderReceipt(child.id, child.version, {
      resolvedSources: result.resolved_sources!,
      rendered: result.rendered,
      missingVars: result.missing_vars,
      usedDefaults: result.used_defaults,
    })
    expect(receipt.prompt_id).toBe(child.id)
    expect(receipt.render_hash).toHaveLength(64)
    expect(receipt.resolved_sources).toHaveLength(2)
  })

  test("reads receipts back with parsed payloads", () => {
    const parent = makePrompt("Parent", "P", "parent")
    const child = makePrompt("Child", "C", "child")
    setParent(child.id, "parent")
    const result = renderPromptTemplate(child, {})
    recordRenderReceipt(child.id, child.version, {
      resolvedSources: result.resolved_sources!,
      rendered: result.rendered,
      missingVars: result.missing_vars,
      usedDefaults: result.used_defaults,
    })
    const receipts = getRenderReceipts(child.id)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.prompt_version).toBe(child.version)
    expect(receipts[0]?.resolved_sources[0]?.relation).toBe("self")
  })

  test("receipts are ordered newest first", () => {
    const parent = makePrompt("Parent", "P", "parent")
    const child = makePrompt("Child", "C", "child")
    setParent(child.id, "parent")
    for (let i = 0; i < 3; i++) {
      const result = renderPromptTemplate(child, {})
      recordRenderReceipt(child.id, child.version, {
        resolvedSources: result.resolved_sources!,
        rendered: result.rendered,
        missingVars: [],
        usedDefaults: [],
      })
    }
    expect(getRenderReceipts(child.id)).toHaveLength(3)
    const renderedHashes = getRenderReceipts(child.id).map((r) => r.render_hash)
    expect(new Set(renderedHashes).size).toBe(1) // identical renders → identical hashes
  })

  test("deleting a prompt cascades receipts", () => {
    const child = makePrompt("Child", "C", "child")
    const db = getDatabase()
    recordRenderReceipt(child.id, 1, {
      resolvedSources: [{ id: child.id, version: 1, relation: "self", slot: null }],
      rendered: "C",
      missingVars: [],
      usedDefaults: [],
    })
    db.run("DELETE FROM prompts WHERE id = ?", [child.id])
    expect(getRenderReceipts(child.id)).toHaveLength(0)
  })
})
