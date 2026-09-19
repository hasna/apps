process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildServer } from "./index.js";

const packageRoot = resolve(import.meta.dir, "../..");
const EXPECTED_FULL_PROFILE_TOOL_COUNT = 124;

type InternalServer = ReturnType<typeof buildServer> & {
  server: {
    _requestHandlers: Map<string, (request: unknown) => Promise<{ tools: Array<{ name: string }> }>>;
  };
};

function readPublicDoc(relativePath: string): string {
  return readFileSync(resolve(packageRoot, relativePath), "utf8");
}

async function fullRuntimeToolNames(): Promise<string[]> {
  const server = buildServer("full") as InternalServer;
  const handler = server.server._requestHandlers.get("tools/list");
  if (!handler) throw new Error("tools/list handler missing");
  return (await handler({ method: "tools/list", params: {} })).tools.map((tool) => tool.name);
}

function matchedCounts(text: string, pattern: RegExp): number[] {
  return Array.from(text.matchAll(pattern), (match) => Number(match[1]));
}

describe("public MCP compatibility documentation", () => {
  test("derives every current full-profile count and inventory entry from the live runtime", async () => {
    const runtimeNames = await fullRuntimeToolNames();
    const runtimeCount = runtimeNames.length;
    expect(runtimeCount, "full-profile tool count drift requires an intentional ratchet update").toBe(
      EXPECTED_FULL_PROFILE_TOOL_COUNT,
    );
    expect(runtimeNames).toContain("memory_audit_stats");

    const manifest = JSON.parse(readPublicDoc("package.json")) as { version: string };
    const changelog = readPublicDoc("CHANGELOG.md");
    const releaseHeading = `## ${manifest.version}\n`;
    const releaseStart = changelog.indexOf(releaseHeading);
    expect(releaseStart).toBeGreaterThanOrEqual(0);
    const afterHeading = releaseStart + releaseHeading.length;
    const nextRelease = changelog.indexOf("\n## ", afterHeading);
    const currentRelease = changelog.slice(
      releaseStart,
      nextRelease === -1 ? changelog.length : nextRelease,
    );

    const claims: Array<[string, string, RegExp]> = [
      ["README.md", readPublicDoc("README.md"), /explicit `full` profile preserves all (\d+) tools/g],
      ["docs/MCP.md introduction", readPublicDoc("docs/MCP.md"), /profile preserves all (\d+) tools/g],
      ["docs/MCP.md profile table", readPublicDoc("docs/MCP.md"), /\| `full` \| all (\d+) tools plus/g],
      ["AGENTS.md", readPublicDoc("AGENTS.md"), /`full` — compatibility profile exposing all (\d+) tools/g],
      ["CLAUDE.md", readPublicDoc("CLAUDE.md"), /MCP server — (\d+) live tools/g],
      ["current CHANGELOG.md release", currentRelease!, /`full` preserves the complete (\d+)-tool compatibility/g],
    ];

    for (const [label, text, pattern] of claims) {
      const counts = matchedCounts(text, pattern);
      expect(counts.length, `${label} must carry a full-profile compatibility count`).toBeGreaterThan(0);
      expect(counts, `${label} must match the ${runtimeCount}-tool runtime`).toEqual(
        Array.from({ length: counts.length }, () => runtimeCount),
      );
    }

    const mcpDoc = readPublicDoc("docs/MCP.md");
    const inventory = mcpDoc.match(
      /^## Full-profile tool inventory\n([\s\S]*?)(?=^## Resources$)/m,
    )?.[1];
    expect(inventory).toBeDefined();

    const inventoryNames: string[] = [];
    const categories = Array.from(
      inventory!.matchAll(/^### .+ \((\d+)\)\n\n```text\n([\s\S]*?)\n```/gm),
    );
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      const declaredCount = Number(category[1]);
      const names = category[2]!.split("\n").map((name) => name.trim()).filter(Boolean);
      expect(declaredCount, `inventory heading must count its ${names.join(", ")} entries`).toBe(names.length);
      inventoryNames.push(...names);
    }

    expect(new Set(inventoryNames).size, "full-profile inventory must not duplicate tools").toBe(inventoryNames.length);
    expect(inventoryNames).toContain("memory_audit_stats");
    expect([...inventoryNames].sort()).toEqual([...runtimeNames].sort());
  });
});
