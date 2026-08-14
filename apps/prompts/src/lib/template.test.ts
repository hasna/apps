import { describe, expect, test } from "bun:test"
import { extractVariables, extractVariableInfo, renderTemplate, validateVars } from "./template.js"

describe("extractVariables", () => {
  test("extracts simple variables", () => {
    const vars = extractVariables("Hello {{name}}, you are {{age}} years old")
    expect(vars).toContain("name")
    expect(vars).toContain("age")
    expect(vars).toHaveLength(2)
  })

  test("extracts variables with defaults", () => {
    const vars = extractVariables("Hello {{name|World}}")
    expect(vars).toContain("name")
  })

  test("deduplicates repeated vars", () => {
    const vars = extractVariables("{{foo}} and {{foo}} again")
    expect(vars).toHaveLength(1)
  })

  test("returns empty for no vars", () => {
    expect(extractVariables("No variables here")).toHaveLength(0)
  })

  test("handles spaces around var name", () => {
    const vars = extractVariables("{{ name }} and {{ age }}")
    expect(vars).toContain("name")
    expect(vars).toContain("age")
  })
})

describe("extractVariableInfo", () => {
  test("required vars have no default", () => {
    const infos = extractVariableInfo("{{name}}")
    expect(infos[0]?.required).toBe(true)
    expect(infos[0]?.default).toBeNull()
  })

  test("optional vars have default", () => {
    const infos = extractVariableInfo("{{name|World}}")
    expect(infos[0]?.required).toBe(false)
    expect(infos[0]?.default).toBe("World")
  })

  test("default with spaces is trimmed", () => {
    const infos = extractVariableInfo("{{ name | Hello World }}")
    expect(infos[0]?.default).toBe("Hello World")
  })
})

describe("renderTemplate", () => {
  test("replaces simple variables", () => {
    const result = renderTemplate("Hello {{name}}", { name: "Alice" })
    expect(result.rendered).toBe("Hello Alice")
    expect(result.missing_vars).toHaveLength(0)
  })

  test("uses defaults for missing optional vars", () => {
    const result = renderTemplate("Hello {{name|World}}", {})
    expect(result.rendered).toBe("Hello World")
    expect(result.used_defaults).toContain("name")
    expect(result.missing_vars).toHaveLength(0)
  })

  test("tracks missing required vars", () => {
    const result = renderTemplate("Hello {{name}}", {})
    expect(result.missing_vars).toContain("name")
    expect(result.rendered).toContain("{{name}}") // left unresolved
  })

  test("provided value overrides default", () => {
    const result = renderTemplate("Hello {{name|World}}", { name: "Alice" })
    expect(result.rendered).toBe("Hello Alice")
    expect(result.used_defaults).toHaveLength(0)
  })

  test("handles multiple vars", () => {
    const result = renderTemplate("{{greeting|Hi}} {{name}}, you have {{count|0}} messages", {
      name: "Bob",
      count: "5",
    })
    expect(result.rendered).toBe("Hi Bob, you have 5 messages")
    expect(result.used_defaults).toContain("greeting")
  })
})

describe("validateVars", () => {
  test("detects missing required vars", () => {
    const result = validateVars("{{name}} {{age}}", {})
    expect(result.missing).toContain("name")
    expect(result.missing).toContain("age")
  })

  test("detects extra vars", () => {
    const result = validateVars("{{name}}", { name: "Alice", extra: "unused" })
    expect(result.extra).toContain("extra")
  })

  test("optional vars are not missing", () => {
    const result = validateVars("{{name|default}}", {})
    expect(result.missing).toHaveLength(0)
    expect(result.optional).toContain("name")
  })
})
