import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validatePublicTextSurfaces } from "./public-release-gate.js";

const root = join(import.meta.dir, "..", "..");

function readDoc(path: string): string {
  return readFileSync(join(root, path), "utf-8");
}

describe("local agent adapter docs", () => {
  test("document copy-pasteable local recipes for agent-native setup and execution", () => {
    const doc = readDoc("docs/agent-adapters.md");

    for (const required of [
      "bun install -g @hasna/todos",
      "todos project-bootstrap",
      "todos mcp --register codex --global",
      "todos mcp --register claude --global",
      "todos mcp",
      "Takumi-style adapters",
      "todos workflows show goal-planning",
      "todos inbox parse --file goal-plan.md --json",
      "todos inbox parse --file goal-plan.md --apply --json",
      "todos claim codex",
      "todos inspect",
      "todos comment",
      "todos update",
      "todos context-pack",
      "todos record-verification",
      "todos done",
      "bun run test:no-cloud",
    ]) {
      expect(doc).toContain(required);
    }
  });

  test("keeps adapter recipes local-only and public-package safe", () => {
    const readme = readDoc("README.md");
    const doc = readDoc("docs/agent-adapters.md");

    expect(validatePublicTextSurfaces([
      { path: "README.md", text: readme },
      { path: "docs/agent-adapters.md", text: doc },
    ])).toEqual([]);
    expect(doc).not.toMatch(/https?:\/\/[^)\s]+/);
    expect(doc).not.toMatch(/\b[A-Z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*=/);
  });
});
