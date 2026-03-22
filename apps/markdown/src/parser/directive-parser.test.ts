import { describe, test, expect } from "bun:test";
import { parseDirectives } from "./directive-parser";

describe("parseDirectives", () => {
  test("parses @import", () => {
    const { directives } = parseDirectives("@import ./schema.omp.md");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("import");
    expect((directives[0] as any).path).toBe("./schema.omp.md");
  });

  test("parses @repeat", () => {
    const { directives } = parseDirectives("@repeat 5");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("repeat");
    expect((directives[0] as any).count).toBe(5);
  });

  test("parses @if", () => {
    const { directives } = parseDirectives("@if database engine is postgres");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("if");
    expect((directives[0] as any).condition).toBe("database engine is postgres");
  });

  test("parses @use", () => {
    const { directives } = parseDirectives("@use mcp:mementos");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("use");
    expect((directives[0] as any).tool).toBe("mcp:mementos");
  });

  test("parses @emit", () => {
    const { directives } = parseDirectives("@emit db-ready");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("emit");
    expect((directives[0] as any).event).toBe("db-ready");
  });

  test("parses @hook before", () => {
    const { directives } = parseDirectives("@hook before deploy");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("hook");
    expect((directives[0] as any).timing).toBe("before");
    expect((directives[0] as any).targetId).toBe("deploy");
  });

  test("parses @hook after", () => {
    const { directives } = parseDirectives("@hook after seed");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("hook");
    expect((directives[0] as any).timing).toBe("after");
    expect((directives[0] as any).targetId).toBe("seed");
  });

  test("parses pattern instantiation @crud-api(notes, fields)", () => {
    const { directives } = parseDirectives("@crud-api(notes, { title: string, content: string })");
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("instantiate");
    expect((directives[0] as any).patternName).toBe("crud-api");
    expect((directives[0] as any).args.arg0).toBe("notes");
    expect((directives[0] as any).args.arg1).toBe("{ title: string, content: string }");
  });

  test("parses pattern instantiation with named args", () => {
    const { directives } = parseDirectives("@page-set(entity=notes, features=search)");
    expect(directives).toHaveLength(1);
    expect((directives[0] as any).args.entity).toBe("notes");
    expect((directives[0] as any).args.features).toBe("search");
  });

  test("parses @pattern definition", () => {
    const raw = `@pattern my-template(entity, fields)
This is the template body for {{entity}}.
It spans multiple lines.`;

    const { patterns } = parseDirectives(raw);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe("my-template");
    expect(patterns[0].params).toEqual(["entity", "fields"]);
    expect(patterns[0].bodyTemplate).toContain("This is the template body");
    expect(patterns[0].bodyTemplate).toContain("multiple lines");
  });

  test("ignores non-directive lines", () => {
    const raw = `Some text
not a directive
@import ./file.omp.md
more text
@use stripe`;

    const { directives } = parseDirectives(raw);
    expect(directives).toHaveLength(2);
    expect(directives[0].kind).toBe("import");
    expect(directives[1].kind).toBe("use");
  });

  test("tracks line numbers", () => {
    const raw = `some text
@import ./a.omp.md
more text
@use tool`;

    const { directives } = parseDirectives(raw, 10);
    expect(directives[0].lineNumber).toBe(11);
    expect(directives[1].lineNumber).toBe(13);
  });

  test("does not treat reserved names as pattern instantiation", () => {
    const raw = `@import ./file.omp.md
@repeat 3`;

    const { directives } = parseDirectives(raw);
    expect(directives).toHaveLength(2);
    expect(directives[0].kind).toBe("import");
    expect(directives[1].kind).toBe("repeat");
    // Neither should be "instantiate"
    expect(directives.every((d) => d.kind !== "instantiate")).toBe(true);
  });

  test("parses multiple directives in one block", () => {
    const raw = `@import ./base.omp.md
@use mcp:todos
@emit setup-complete
@hook before deploy
@crud-api(users, { email: string })`;

    const { directives } = parseDirectives(raw);
    expect(directives).toHaveLength(5);
    expect(directives.map((d) => d.kind)).toEqual([
      "import", "use", "emit", "hook", "instantiate",
    ]);
  });
});
