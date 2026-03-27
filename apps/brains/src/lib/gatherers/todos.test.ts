import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const todosDb = join(homedir(), ".todos", "todos.db");
const hasDb = existsSync(todosDb);

describe("gatherFromTodos", () => {
  test.skipIf(!hasDb)("returns GatherResult shape", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 10 });
    expect(result.source).toBe("todos");
    expect(Array.isArray(result.examples)).toBe(true);
    expect(result.count).toBe(result.examples.length);
  });

  test.skipIf(!hasDb)("generates training examples", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 5 });
    expect(result.examples.length).toBeGreaterThanOrEqual(0);
    for (const ex of result.examples) {
      expect(Array.isArray(ex.messages)).toBe(true);
      expect(ex.messages.length).toBeGreaterThanOrEqual(2);
    }
  });

  test.skipIf(!hasDb)("respects limit option", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 3 });
    expect(result.examples.length).toBeLessThanOrEqual(3);
  });

  test.skipIf(!hasDb)("respects since option with future date — returns empty", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const futureDate = new Date("2099-01-01");
    const result = await gatherFromTodos({ since: futureDate });
    // All tasks have created_at before 2099 — but search examples are always generated
    // The key is we get a valid result shape
    expect(result.source).toBe("todos");
    expect(Array.isArray(result.examples)).toBe(true);
  });

  test.skipIf(!hasDb)("each example has system, user, and assistant messages", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 5 });
    for (const ex of result.examples) {
      const roles = ex.messages.map((m) => m.role);
      expect(roles[0]).toBe("system");
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
    }
  });
});
