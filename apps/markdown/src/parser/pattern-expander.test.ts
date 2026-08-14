import { describe, test, expect } from "bun:test";
import { expandPattern, expandAllPatterns, getBuiltinPatternNames } from "./pattern-expander";
import type { OmpPatternInstance, OmpPattern } from "../types/index.js";

function makeInstance(patternName: string, args: Record<string, string>): OmpPatternInstance {
  return {
    kind: "instantiate",
    patternName,
    args,
    raw: `@${patternName}(${Object.values(args).join(", ")})`,
    lineNumber: 1,
  };
}

describe("expandPattern", () => {
  test("expands @crud-api into 5 endpoint cards", () => {
    const instance = makeInstance("crud-api", {
      arg0: "notes",
      arg1: "{ title: string, content: string }",
    });

    const cards = expandPattern(instance, []);
    expect(cards).toHaveLength(5);
    expect(cards[0].raw).toContain("id: list-notes");
    expect(cards[0].raw).toContain("method: GET");
    expect(cards[1].raw).toContain("id: create-notes");
    expect(cards[1].raw).toContain("method: POST");
    expect(cards[2].raw).toContain("id: get-notes");
    expect(cards[3].raw).toContain("id: update-notes");
    expect(cards[4].raw).toContain("id: delete-notes");
  });

  test("expands @page-set into 3 page cards", () => {
    const instance = makeInstance("page-set", {
      arg0: "notes",
      arg1: "{ search: true, tags: true }",
    });

    const cards = expandPattern(instance, []);
    expect(cards).toHaveLength(3);
    expect(cards[0].raw).toContain("id: notes-list");
    expect(cards[0].raw).toContain("path: /notes");
    expect(cards[1].raw).toContain("id: notes-editor");
    expect(cards[2].raw).toContain("id: notes-create");
  });

  test("substitutes args into crud-api body text", () => {
    const instance = makeInstance("crud-api", {
      arg0: "tags",
      arg1: "{ name: string }",
    });

    const cards = expandPattern(instance, []);
    expect(cards[0].raw).toContain("list of all tags");
    expect(cards[1].raw).toContain("new tags record");
    expect(cards[1].raw).toContain("body: { name: string }");
  });

  test("expands user-defined pattern", () => {
    const userPattern: OmpPattern = {
      name: "my-component",
      params: ["name", "props"],
      bodyTemplate: `type: component
id: {{name}}
props: {{props}}

A custom component called {{name}}.`,
      lineNumber: 1,
    };

    const instance = makeInstance("my-component", {
      name: "search-bar",
      props: "query: string, onSearch: function",
    });

    const cards = expandPattern(instance, [userPattern]);
    expect(cards).toHaveLength(1);
    expect(cards[0].raw).toContain("id: search-bar");
    expect(cards[0].raw).toContain("props: query: string, onSearch: function");
    expect(cards[0].raw).toContain("custom component called search-bar");
  });

  test("user-defined pattern with multiple cards", () => {
    const userPattern: OmpPattern = {
      name: "auth-pages",
      params: ["redirect"],
      bodyTemplate: `type: page
id: login
path: /login

Login page. Redirect to {{redirect}} on success.
---
type: page
id: signup
path: /signup

Signup page. Redirect to {{redirect}} on success.`,
      lineNumber: 1,
    };

    const instance = makeInstance("auth-pages", { redirect: "/dashboard" });
    const cards = expandPattern(instance, [userPattern]);
    expect(cards).toHaveLength(2);
    expect(cards[0].raw).toContain("id: login");
    expect(cards[0].raw).toContain("Redirect to /dashboard");
    expect(cards[1].raw).toContain("id: signup");
  });

  test("returns empty for unknown pattern", () => {
    const instance = makeInstance("nonexistent", { arg0: "test" });
    const cards = expandPattern(instance, []);
    expect(cards).toHaveLength(0);
  });

  test("appends additional context to each card", () => {
    const instance = makeInstance("crud-api", {
      arg0: "notes",
      arg1: "{ title: string }",
    });

    const cards = expandPattern(instance, [], "All endpoints must log access.");
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(card.raw).toContain("All endpoints must log access.");
    }
  });

  test("user patterns take priority over built-ins", () => {
    const userPattern: OmpPattern = {
      name: "crud-api",
      params: ["entity"],
      bodyTemplate: `type: custom
id: custom-{{entity}}

Custom CRUD override.`,
      lineNumber: 1,
    };

    const instance = makeInstance("crud-api", { entity: "notes" });
    const cards = expandPattern(instance, [userPattern]);
    expect(cards).toHaveLength(1);
    expect(cards[0].raw).toContain("Custom CRUD override");
  });
});

describe("expandAllPatterns", () => {
  test("expands multiple instances", () => {
    const instances = [
      makeInstance("crud-api", { arg0: "notes", arg1: "{}" }),
      makeInstance("crud-api", { arg0: "tags", arg1: "{}" }),
    ];

    const cards = expandAllPatterns(instances, []);
    expect(cards).toHaveLength(10); // 5 + 5
  });
});

describe("getBuiltinPatternNames", () => {
  test("returns built-in pattern names", () => {
    const names = getBuiltinPatternNames();
    expect(names).toContain("crud-api");
    expect(names).toContain("page-set");
  });
});
