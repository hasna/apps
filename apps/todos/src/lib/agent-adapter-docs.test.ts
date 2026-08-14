import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validatePublicTextSurfaces } from "./public-release-gate.js";
import { AGENT_ADAPTER_DOCS, MCP_REGISTRABLE_CLI_AGENTS } from "./agent-adapter-docs.js";

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
      "todos mcp --register cursor --global",
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

  // Regression for `todos mcp --register takumi` shipping in doc metadata
  // (register_cli, workflow, failure_modes recovery) while the CLI rejected
  // takumi with "Unknown agent". The reader of a recovery field is an agent;
  // an advertised command that exits 1 strands it. Every `todos mcp
  // --register/--unregister <agent>` in the docs must name a registrable agent.
  test("every registration command advertised in adapter docs names a registrable agent", () => {
    const payload = JSON.stringify(AGENT_ADAPTER_DOCS);
    const matches = [...payload.matchAll(/todos mcp --(?:un)?register ([a-z-]+)/g)];

    // Positive control: the probe must find the advertised commands (a zero
    // here would mean the regex went blind, not that the docs are clean).
    expect(matches.length).toBeGreaterThanOrEqual(6);

    const advertised = [...new Set(matches.map((m) => m[1]))].sort();
    const unregistrable = advertised.filter(
      (agent) => !(MCP_REGISTRABLE_CLI_AGENTS as readonly string[]).includes(agent),
    );
    expect(unregistrable).toEqual([]);

    // The takumi command specifically — the shipped defect — must be both
    // advertised and registrable.
    expect(advertised).toContain("takumi");
    expect(MCP_REGISTRABLE_CLI_AGENTS).toContain("takumi");
  });
});
