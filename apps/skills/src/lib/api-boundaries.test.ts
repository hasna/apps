import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mergeRemoteRegistry } from "./remote-registry.js";
import type { SkillMeta } from "./registry.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const LOCAL_ONLY_FIXTURE: SkillMeta[] = [
  {
    name: "local-skill",
    displayName: "Local Skill",
    description: "Written on this machine",
    category: "Development Tools",
    tags: [],
    source: "custom",
  },
  {
    name: "bundled-skill",
    displayName: "Bundled Skill",
    description: "Ships with the CLI",
    category: "Development Tools",
    tags: [],
    source: "official",
  },
];

describe("API-first boundary contract", () => {
  const doc = readFileSync(join(process.cwd(), "docs/architecture/api-first-boundaries.md"), "utf8");

  test("keeps CLI, MCP, and web as thin adapters", () => {
    expect(doc).toContain("CLI, MCP, and future web UI clients are thin adapters");
    expect(doc).toContain("Client surfaces may format inputs, display outputs, and call APIs");
    expect(doc).toMatch(/They may not\s+own the canonical implementation/);
  });

  test("assigns durable product behavior to backend layers", () => {
    for (const phrase of [
      "Database schema and migrations",
      "Service modules",
      "HTTP API routes",
      "Worker jobs",
      "Webhooks",
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  test("defines shared API contracts for future web readiness", () => {
    expect(doc).toContain("Versioned API routes under `/api/v1`");
    expect(doc).toMatch(/Every API response should be stable enough for CLI, MCP, automated tests, and\s+future web clients/);
    expect(doc).toContain("Create a shared typed client before web-specific data access grows");
  });

  test("prevents privileged worker and billing bypasses", () => {
    expect(doc).toContain("MCP tools should not bypass approval gates");
    expect(doc).toContain("Clients observe worker state through API reads");
    expect(doc).toMatch(/They do not enqueue privileged\s+jobs directly/);
  });

  describe("remote merge boundary (R1 fail-closed default read)", () => {
    const originalSkillsApiUrl = process.env.SKILLS_API_URL;
    const originalSkillsApiKey = process.env.SKILLS_API_KEY;
    const originalSkillApiKey = process.env.SKILL_API_KEY;

    afterEach(() => {
      if (originalSkillsApiUrl === undefined) delete process.env.SKILLS_API_URL;
      else process.env.SKILLS_API_URL = originalSkillsApiUrl;
      if (originalSkillsApiKey === undefined) delete process.env.SKILLS_API_KEY;
      else process.env.SKILLS_API_KEY = originalSkillsApiKey;
      if (originalSkillApiKey === undefined) delete process.env.SKILL_API_KEY;
      else process.env.SKILL_API_KEY = originalSkillApiKey;
    });

    test("an unconfigured install keeps the exact local registry — byte for byte", async () => {
      delete process.env.SKILLS_API_URL;
      delete process.env.SKILLS_API_KEY;
      const merged = await mergeRemoteRegistry(LOCAL_ONLY_FIXTURE, {
        fetchImpl: async () => {
          throw new Error("must not fetch when unconfigured");
        },
      });
      expect(merged).toEqual(LOCAL_ONLY_FIXTURE);
      expect(JSON.stringify(merged)).toBe(JSON.stringify(LOCAL_ONLY_FIXTURE));
    });

    test("an origin without a credential fails closed instead of serving the local half", async () => {
      // Owner ruling 2026-09-04 (hasna/apps#1720): hosted with no credential is
      // LOUD. Returning the local registry here was a false green — the caller
      // was pointed at an instance and got a healthy-looking answer that had
      // never been near it. There is no module cache to work around any more:
      // the ladder re-resolves per call, so the env-only path is asserted
      // directly.
      process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
      await expect(
        mergeRemoteRegistry(LOCAL_ONLY_FIXTURE, {
          fetchImpl: async () => {
            throw new Error("must not fetch without a credential");
          },
        }),
      ).rejects.toThrow(/no API key resolved/);
    });

    test("a rejected authenticated read surfaces a clear error, never a silent empty", async () => {
      process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
      process.env["SKILLS_API_KEY"] = "fixture-revoked";
      let error: Error | null = null;
      try {
        await mergeRemoteRegistry(LOCAL_ONLY_FIXTURE, {
          fetchImpl: async () => new Response("nope", { status: 403, statusText: "Forbidden" }),
        });
      } catch (caught) {
        error = caught as Error;
      }
      expect(error).not.toBeNull();
      expect(error?.message).toContain("Remote registry request failed: 403");
    });

    test("a successful authenticated read merges remote rows tagged source=remote", async () => {
      process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
      process.env["SKILLS_API_KEY"] = "fixture-valid";
      const merged = await mergeRemoteRegistry(LOCAL_ONLY_FIXTURE, {
        fetchImpl: async (input, init) => {
          expect(String(input)).toBe("https://skills.example.com/api/v1/skills");
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-valid");
          return Response.json({ skills: [{ name: "remote-only-skill", displayName: "Remote Only" }] });
        },
      });
      const remote = merged.find((skill) => skill.name === "remote-only-skill");
      expect(remote).toMatchObject({ source: "remote" });
      expect(merged).toHaveLength(LOCAL_ONLY_FIXTURE.length + 1);
    });
  });
});
