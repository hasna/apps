import { describe, expect, test } from "bun:test";
import { compactInteraction, compactLines, compactRecipe, parseLimit, truncateText } from "./compact-output.js";

describe("compact output helpers", () => {
  test("truncates long text and caps limits", () => {
    expect(truncateText("x".repeat(150), 20)).toBe(`${"x".repeat(17)}...`);
    expect(parseLimit(["--limit=500"], 10)).toBe(100);
    expect(parseLimit(["--limit", "3"], 10)).toBe(3);
    expect(parseLimit(["--limit=bad"], 10)).toBe(10);
  });

  test("keeps file previews bounded unless full detail is requested elsewhere", () => {
    const content = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
    const compact = compactLines(content, 5, 1000);

    expect(compact.lineCount).toBe(120);
    expect(compact.truncated).toBe(true);
    expect(compact.content.split("\n")).toHaveLength(5);
  });

  test("compacts records while preserving verbose detail mode", () => {
    const interaction = {
      id: 1,
      exit_code: 0,
      nl: "prompt ".repeat(40),
      command: "command ".repeat(40),
      tokens_saved: 12,
      created_at: 123,
    };
    const compact = compactInteraction(interaction);
    const verbose = compactInteraction(interaction, true);

    expect(String(compact.prompt).length).toBeLessThan(String(verbose.prompt).length);
    expect(compact.status).toBe("ok");
  });

  test("keeps recipe list rows compact by default", () => {
    const recipe = compactRecipe({
      id: "sys-long",
      name: "long-command",
      command: "echo ".repeat(80),
      collection: "tests",
      tags: ["a", "b"],
      variables: [{ name: "path" }],
    });

    expect(String(recipe.command).length).toBeLessThan(130);
    expect(recipe.scope).toBe("system");
  });
});
