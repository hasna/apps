import { describe, expect, test } from "bun:test"
import { extractVariables, extractVariableInfo, renderTemplate, validateVars, getPath } from "./template.js"
import { TemplateRenderError } from "../types/index.js"

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

  test("extracts dot paths as full names", () => {
    const vars = extractVariables("{{request.owner.name}}")
    expect(vars).toEqual(["request.owner.name"])
  })

  test("escaped braces are not variables", () => {
    const vars = extractVariables("\\{{name}} stays literal")
    expect(vars).toHaveLength(0)
  })

  test("partial references are not variables", () => {
    const vars = extractVariables("{{>common-header}} then {{name}}")
    expect(vars).toEqual(["name"])
  })

  test("unclosed and malformed tokens stay literal", () => {
    expect(extractVariables("{{foo")).toHaveLength(0)
    expect(extractVariables("{{foo bar}}")).toHaveLength(0)
    expect(extractVariables("{{}}")).toHaveLength(0)
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

  test("escaped braces are not variables", () => {
    const infos = extractVariableInfo("\\{{name|hidden}}")
    expect(infos).toHaveLength(0)
  })

  test("partials are not variables", () => {
    const infos = extractVariableInfo("{{>partial}} {{name|d}}")
    expect(infos).toHaveLength(1)
    expect(infos[0]?.name).toBe("name")
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

  test("escaped braces render literally without the backslash", () => {
    const result = renderTemplate("\\{{name}} is literal, {{name}} is real", { name: "Alice" })
    expect(result.rendered).toBe("{{name}} is literal, Alice is real")
    expect(result.missing_vars).toHaveLength(0)
  })

  test("double-escaped braces keep one literal backslash", () => {
    const result = renderTemplate("\\\\{{name}}", {})
    expect(result.rendered).toBe("\\{{name}}")
  })

  test("renders numeric values", () => {
    const result = renderTemplate("Count: {{count}}", { count: 42 })
    expect(result.rendered).toBe("Count: 42")
  })

  test("renders boolean values", () => {
    const result = renderTemplate("Enabled: {{enabled}}", { enabled: true })
    expect(result.rendered).toBe("Enabled: true")
  })

  test("renders objects as canonical JSON", () => {
    const result = renderTemplate("Payload: {{payload}}", { payload: { a: 1, b: [true, null] } })
    expect(result.rendered).toBe('Payload: {"a":1,"b":[true,null]}')
  })

  test("renders arrays as canonical JSON", () => {
    const result = renderTemplate("Items: {{items}}", { items: ["x", "y"] })
    expect(result.rendered).toBe('Items: ["x","y"]')
  })

  test("object render format json-pretty is selected by definition", () => {
    const result = renderTemplate("{{payload}}", { payload: { a: 1 } }, {
      definitions: { payload: { name: "payload", render_format: "json-pretty" } },
    })
    expect(result.rendered).toBe('{\n  "a": 1\n}')
  })

  test("resolves dot paths from nested values", () => {
    const result = renderTemplate("Hello {{request.owner.name}}", {
      request: { owner: { name: "Andrei" } },
    })
    expect(result.rendered).toBe("Hello Andrei")
    expect(result.missing_vars).toHaveLength(0)
  })

  test("flat keys take precedence over dot paths", () => {
    const result = renderTemplate("{{a.b}}", { "a.b": "flat" })
    expect(result.rendered).toBe("flat")
  })

  test("missing intermediate object in dot path is missing", () => {
    const result = renderTemplate("{{request.owner.name}}", { request: {} })
    expect(result.missing_vars).toContain("request.owner.name")
    expect(result.rendered).toContain("{{request.owner.name}}")
  })

  test("typed default from definition is used when missing", () => {
    const result = renderTemplate("{{count}}", {}, {
      definitions: { count: { name: "count", type: "number", typed_default: 7 } },
    })
    expect(result.rendered).toBe("7")
    expect(result.used_defaults).toContain("count")
    expect(result.missing_vars).toHaveLength(0)
  })

  test("inline default wins over typed default", () => {
    const result = renderTemplate("{{name|inline}}", {}, {
      definitions: { name: { name: "name", typed_default: "typed" } },
    })
    expect(result.rendered).toBe("inline")
  })

  test("provided value beats typed default", () => {
    const result = renderTemplate("{{count}}", { count: 3 }, {
      definitions: { count: { name: "count", typed_default: 7 } },
    })
    expect(result.rendered).toBe("3")
  })

  test("coerces numeric string to number for typed definitions", () => {
    const result = renderTemplate("{{count}}", { count: "42" }, {
      definitions: { count: { name: "count", type: "number" } },
    })
    expect(result.rendered).toBe("42")
  })

  test("coerces boolean strings for typed definitions", () => {
    const result = renderTemplate("{{flag}}", { flag: "false" }, {
      definitions: { flag: { name: "flag", type: "boolean" } },
    })
    expect(result.rendered).toBe("false")
  })

  test("parses object strings for object-typed definitions", () => {
    const result = renderTemplate("{{payload}}", { payload: '{"a":2}' }, {
      definitions: { payload: { name: "payload", type: "object" } },
    })
    expect(result.rendered).toBe('{"a":2}')
  })
})

describe("strict rendering", () => {
  test("missing required value throws named error", () => {
    expect(() => renderTemplate("Hello {{name}}", {}, { strict: true })).toThrow(
      /MISSING_VARIABLE/
    )
  })

  test("error carries code and missing names", () => {
    let caught: TemplateRenderError | null = null
    try {
      renderTemplate("{{a}} and {{b}}", {}, { strict: true })
    } catch (e) {
      caught = e as TemplateRenderError
    }
    expect(caught).not.toBeNull()
    expect(caught?.code).toBe("MISSING_VARIABLE")
    expect(caught?.missing).toEqual(["a", "b"])
  })

  test("optional vars do not fail strict render", () => {
    const result = renderTemplate("Hello {{name|World}}", {}, { strict: true })
    expect(result.rendered).toBe("Hello World")
  })

  test("typed defaults satisfy strict render", () => {
    const result = renderTemplate("{{count}}", {}, {
      strict: true,
      definitions: { count: { name: "count", typed_default: 7 } },
    })
    expect(result.rendered).toBe("7")
  })

  test("strict rejects type mismatch for object definition", () => {
    expect(() =>
      renderTemplate("{{payload}}", { payload: "not-json" }, {
        strict: true,
        definitions: { payload: { name: "payload", type: "object" } },
      })
    ).toThrow(/VARIABLE_TYPE_MISMATCH/)
  })

  test("strict enforces validation constraints", () => {
    expect(() =>
      renderTemplate("{{code}}", { code: "abc" }, {
        strict: true,
        definitions: { code: { name: "code", validation: JSON.stringify({ pattern: "^[A-Z]+$" }) } },
      })
    ).toThrow(/VARIABLE_VALIDATION_FAILED/)
  })

  test("validation passes when constraint holds", () => {
    const result = renderTemplate("{{code}}", { code: "ABC" }, {
      strict: true,
      definitions: { code: { name: "code", validation: JSON.stringify({ pattern: "^[A-Z]+$" }) } },
    })
    expect(result.rendered).toBe("ABC")
  })

  test("strict missing partial throws PARTIAL_NOT_FOUND", () => {
    expect(() =>
      renderTemplate("{{>missing-partial}}", {}, {
        strict: true,
        resolvePartial: () => null,
      })
    ).toThrow(/PARTIAL_NOT_FOUND/)
  })
})

describe("preview mode", () => {
  test("missing vars render visible markers, never empty strings", () => {
    const result = renderTemplate("Hello {{name}}", {}, { preview: true })
    expect(result.rendered).toBe("Hello [UNRESOLVED kind:var name=name]")
    expect(result.unresolved).toContain("name")
  })

  test("missing partial renders visible marker", () => {
    const result = renderTemplate("{{>ghost}}", {}, { preview: true, resolvePartial: () => null })
    expect(result.rendered).toBe("[UNRESOLVED kind:partial slug=ghost]")
  })

  test("preview with values still substitutes them", () => {
    const result = renderTemplate("Hi {{name}}, see {{>x}}", { name: "A" }, {
      preview: true,
      resolvePartial: () => ({ body: "PARTIAL" }),
    })
    expect(result.rendered).toBe("Hi A, see PARTIAL")
  })
})

describe("partials", () => {
  test("resolves partials through resolvePartial", () => {
    const result = renderTemplate("Start\n{{>common}}\nEnd", {}, {
      resolvePartial: (slug) => (slug === "common" ? { body: "shared text" } : null),
    })
    expect(result.rendered).toBe("Start\nshared text\nEnd")
  })

  test("missing partial leaves placeholder in non-strict mode", () => {
    const result = renderTemplate("{{>ghost}}", {}, { resolvePartial: () => null })
    expect(result.rendered).toBe("{{>ghost}}")
    expect(result.missing_vars).toHaveLength(0)
  })

  test("partial bodies render their own variables", () => {
    const result = renderTemplate("{{>greet}}", { name: "N" }, {
      resolvePartial: () => ({ body: "Hello {{name}}" }),
    })
    expect(result.rendered).toBe("Hello N")
  })

  test("cycle detection throws TEMPLATE_CYCLE", () => {
    expect(() =>
      renderTemplate("{{>a}}", {}, {
        resolvePartial: (slug) => {
          if (slug === "a") return { body: "A {{>b}}" }
          if (slug === "b") return { body: "B {{>a}}" }
          return null
        },
      })
    ).toThrow(/TEMPLATE_CYCLE/)
  })

  test("depth bound throws TEMPLATE_DEPTH_EXCEEDED", () => {
    expect(() =>
      renderTemplate("{{>a}}", {}, {
        maxDepth: 3,
        resolvePartial: (slug) => (slug.startsWith("a") ? { body: `{{>${slug}x}}` } : null),
      })
    ).toThrow(/TEMPLATE_DEPTH_EXCEEDED/)
  })

  test("partial sources are collected when ids are provided", () => {
    const result = renderTemplate("{{>common}}", {}, {
      resolvePartial: (slug) =>
        slug === "common" ? { body: "shared", id: "prmt-partial", version: 2 } : null,
    })
    expect(result.resolved_sources).toEqual([
      { id: "prmt-partial", version: 2, relation: "partial", slot: null },
    ])
  })

  test("nested partial sources are collected in order", () => {
    const result = renderTemplate("{{>outer}}", {}, {
      resolvePartial: (slug) => {
        if (slug === "outer") return { body: "O {{>inner}}", id: "prmt-outer", version: 1 }
        if (slug === "inner") return { body: "I", id: "prmt-inner", version: 4 }
        return null
      },
    })
    expect(result.rendered).toBe("O I")
    expect(result.resolved_sources).toEqual([
      { id: "prmt-outer", version: 1, relation: "partial", slot: null },
      { id: "prmt-inner", version: 4, relation: "partial", slot: null },
    ])
  })
})

describe("bounds", () => {
  test("byte budget throws TEMPLATE_BYTE_BUDGET_EXCEEDED", () => {
    expect(() =>
      renderTemplate("{{x}}", { x: "z".repeat(100) }, { maxBytes: 50 })
    ).toThrow(/TEMPLATE_BYTE_BUDGET_EXCEEDED/)
  })

  test("byte budget counts final output", () => {
    const result = renderTemplate("{{x}}", { x: "ab" }, { maxBytes: 2 })
    expect(result.rendered).toBe("ab")
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

  test("nested values satisfy dot-path requirements without extra flag", () => {
    const result = validateVars("{{request.owner.name}}", { request: { owner: { name: "A" } } })
    expect(result.missing).toHaveLength(0)
    expect(result.extra).not.toContain("request")
  })

  test("typed default definitions make required vars optional", () => {
    const result = validateVars(
      "{{count}}",
      {},
      { count: { name: "count", typed_default: 1 } }
    )
    expect(result.missing).toHaveLength(0)
    expect(result.optional).toContain("count")
  })
})

describe("getPath", () => {
  test("returns flat values first", () => {
    expect(getPath({ "a.b": "flat" }, "a.b")).toBe("flat")
  })

  test("walks nested objects", () => {
    expect(getPath({ a: { b: { c: 3 } } }, "a.b.c")).toBe(3)
  })

  test("returns undefined for missing intermediate", () => {
    expect(getPath({ a: {} }, "a.b.c")).toBeUndefined()
  })

  test("returns undefined for non-object intermediates", () => {
    expect(getPath({ a: 1 }, "a.b")).toBeUndefined()
  })
})

describe("backward compatibility fixtures", () => {
  const fixtures: Array<{ body: string; vars: Record<string, string>; expected: string }> = [
    { body: "Hello {{name}}", vars: { name: "Alice" }, expected: "Hello Alice" },
    { body: "Hello {{name|World}}", vars: {}, expected: "Hello World" },
    { body: "Hello {{ name | World }}", vars: {}, expected: "Hello World" },
    { body: "{{a}} {{b|1}}", vars: { a: "x" }, expected: "x 1" },
    { body: "no tokens here", vars: { unused: "y" }, expected: "no tokens here" },
    { body: "unclosed {{token", vars: {}, expected: "unclosed {{token" },
    { body: "{{invalid name}}", vars: {}, expected: "{{invalid name}}" },
  ]

  for (const fixture of fixtures) {
    test(`renders "${fixture.body}" byte-compatibly`, () => {
      const result = renderTemplate(fixture.body, fixture.vars)
      expect(result.rendered).toBe(fixture.expected)
    })
  }
})
