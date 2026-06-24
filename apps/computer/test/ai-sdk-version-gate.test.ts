import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("AI SDK version gate", () => {
  test("pins stable AI SDK packages and peer-compatible zod", () => {
    expect(packageJson.dependencies["ai"]).toBe("6.0.200");
    expect(packageJson.dependencies["@ai-sdk/openai"]).toBe("3.0.69");
    expect(packageJson.dependencies["@ai-sdk/anthropic"]).toBe("3.0.82");
    expect(packageJson.dependencies["zod"]).toBe("^3.25.76");
  });
});
