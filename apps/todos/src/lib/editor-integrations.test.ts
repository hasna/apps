import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "../..");
const examplesRoot = join(root, "examples/editor-integrations");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return files(path);
    return [path];
  });
}

describe("local editor integrations", () => {
  test("ships VS Code JetBrains Neovim statusline and picker examples", () => {
    const expected = [
      "docs/editor-integrations.md",
      "examples/editor-integrations/vscode/tasks.json",
      "examples/editor-integrations/jetbrains-external-tools.md",
      "examples/editor-integrations/neovim/todos.lua",
      "examples/editor-integrations/statusline.sh",
      "examples/editor-integrations/task-picker.ts",
      "examples/editor-integrations/contracts.json",
    ];

    for (const path of expected) {
      expect(statSync(join(root, path)).isFile()).toBe(true);
    }
  });

  test("VS Code tasks and integration contract stay on public CLI and MCP surfaces", () => {
    const tasks = JSON.parse(readFileSync(join(examplesRoot, "vscode/tasks.json"), "utf-8"));
    expect(tasks.version).toBe("2.0.0");
    expect(tasks.tasks.map((task: { command: string }) => task.command)).toEqual([
      "todos",
      "todos",
      "todos",
      "todos",
    ]);
    expect(tasks.tasks.flatMap((task: { args: string[] }) => task.args)).toEqual(expect.arrayContaining([
      "--json",
      "ready",
      "active",
      "extract",
      "context-pack",
    ]));

    const contract = JSON.parse(readFileSync(join(examplesRoot, "contracts.json"), "utf-8"));
    expect(contract.localOnly).toBe(true);
    expect(contract.integrations.map((entry: { id: string }) => entry.id)).toEqual([
      "vscode-tasks",
      "jetbrains-external-tools",
      "neovim-json",
      "mcp-agent-client",
    ]);
    expect(contract.integrations.find((entry: { id: string }) => entry.id === "mcp-agent-client").tools).toEqual(expect.arrayContaining([
      "list_tasks",
      "get_next_task",
      "build_agent_context_pack",
      "extract_todos",
      "watch_source_todos",
    ]));
  });

  test("examples avoid hosted URLs private package names and platform internals", () => {
    const forbidden = [
      /platform-todos/i,
      /hasnastudio/i,
      /\bTODOS_API_URL\b/,
      /\bTODOS_MODE\b/,
      /https:\/\/api\./i,
      /npm install/i,
      /@hasnastudio\//i,
    ];
    const offenders: string[] = [];

    for (const file of files(examplesRoot)) {
      const text = readFileSync(file, "utf-8");
      for (const pattern of forbidden) {
        if (pattern.test(text)) offenders.push(`${relative(root, file)}: ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
