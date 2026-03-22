import { describe, test, expect } from "bun:test";
import { validateDocument, lintDocument } from "./validate";
import type { OmpDocument, OmpCard } from "../types/index.js";

function makeCard(overrides: Partial<OmpCard> = {}): OmpCard {
  return {
    type: "custom",
    id: "test",
    depends: [],
    headers: {},
    body: { raw: "Some body.", text: "Some body.", tables: [], inlineDirectives: [] },
    accepts: [],
    sourceFile: "test.omp.md",
    lineNumber: 1,
    ...overrides,
  };
}

function makeDoc(cards: OmpCard[]): OmpDocument {
  return { title: "Test", cards, patterns: [], imports: [], errors: [] };
}

describe("validateDocument", () => {
  test("valid document returns no errors", () => {
    const doc = makeDoc([
      makeCard({ id: "init", type: "project" }),
      makeCard({ id: "db", type: "database", depends: ["init"], headers: { engine: "sqlite" } }),
    ]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors).toHaveLength(0);
  });

  test("detects duplicate IDs", () => {
    const doc = makeDoc([
      makeCard({ id: "init" }),
      makeCard({ id: "init", lineNumber: 10 }),
    ]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Duplicate card id");
  });

  test("detects missing card ID", () => {
    const doc = makeDoc([makeCard({ id: "" })]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("missing required 'id'");
  });

  test("warns on broken depends reference", () => {
    const doc = makeDoc([
      makeCard({ id: "a", depends: ["nonexistent"] }),
    ]);
    const warnings = validateDocument(doc).filter((e) => e.level === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("does not exist");
  });

  test("detects missing required keys for endpoint", () => {
    const doc = makeDoc([
      makeCard({ id: "ep", type: "endpoint", headers: {} }),
    ]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThanOrEqual(2); // method + path
    expect(errors.some((e) => e.message.includes('"method"'))).toBe(true);
    expect(errors.some((e) => e.message.includes('"path"'))).toBe(true);
  });

  test("detects missing required keys for table", () => {
    const doc = makeDoc([
      makeCard({ id: "t", type: "table", headers: {} }),
    ]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors.some((e) => e.message.includes('"db"'))).toBe(true);
  });

  test("detects invalid HTTP method", () => {
    const doc = makeDoc([
      makeCard({ id: "ep", type: "endpoint", headers: { method: "FETCH", path: "/api" } }),
    ]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("invalid HTTP method");
  });

  test("detects empty {{}} directive", () => {
    const doc = makeDoc([
      makeCard({
        id: "a",
        body: {
          raw: "Test {{}} thing",
          text: "Test {{}} thing",
          tables: [],
          inlineDirectives: [
            { raw: "{{}}", content: "", isBuiltinTool: false, start: 5, end: 9 },
          ],
        },
      }),
    ]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("empty {{}}");
  });

  test("valid endpoint passes all checks", () => {
    const doc = makeDoc([
      makeCard({
        id: "list-notes",
        type: "endpoint",
        headers: { method: "GET", path: "/api/notes" },
      }),
    ]);
    const errors = validateDocument(doc).filter((e) => e.level === "error");
    expect(errors).toHaveLength(0);
  });
});

describe("lintDocument", () => {
  test("warns when endpoint has no accepts", () => {
    const doc = makeDoc([
      makeCard({ id: "ep", type: "endpoint", headers: { method: "GET", path: "/api" }, accepts: [] }),
    ]);
    const warnings = lintDocument(doc).filter((e) => e.level === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("no accepts:");
  });

  test("no warning when endpoint has accepts", () => {
    const doc = makeDoc([
      makeCard({
        id: "ep",
        type: "endpoint",
        headers: { method: "GET", path: "/api" },
        accepts: ["returns 200"],
      }),
    ]);
    const warnings = lintDocument(doc).filter((e) => e.level === "warning");
    expect(warnings).toHaveLength(0);
  });

  test("detects isolated cards", () => {
    const doc = makeDoc([
      makeCard({ id: "a" }),
      makeCard({ id: "b" }),
    ]);
    const infos = lintDocument(doc).filter((e) => e.level === "info");
    expect(infos.length).toBeGreaterThanOrEqual(2);
    expect(infos.some((e) => e.message.includes("isolated"))).toBe(true);
  });
});
