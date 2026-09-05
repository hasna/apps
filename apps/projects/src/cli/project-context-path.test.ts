import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSpawnEnv, withoutUnhostedNotice } from "../testing/spawn-env.js";

const CLI_PATH = join(import.meta.dir, "index.ts");

async function runProjects(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI_PATH, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: testSpawnEnv(env),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
  };
}

function text(bytes: Uint8Array): string {
  // The unhosted-mode notice is a required, deliberate line; it is not part of
  // what any command under test writes, so it is stripped here and asserted
  // directly where it IS the subject.
  return withoutUnhostedNotice(Buffer.from(bytes).toString("utf-8"));
}

describe("projects context canonical path resolution", () => {
  test("resolves the existing canonical path by verified stable id and keeps absent paths unresolved", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-context-path-"));
    const projectId = "wks_clicontextpath";
    const projectPath = join(root, "workspaces", projectId);
    const absentPath = join(root, "workspaces", "wks_absentcontextpath");
    mkdirSync(projectPath, { recursive: true });
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        requests.push(`${req.method} ${url.pathname}${url.search}`);
        if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}`) {
          return Response.json({
            id: projectId,
            slug: "cli-context-path",
            name: "CLI Context Path",
            kind: "project",
            status: "active",
            root_id: null,
            recipe_id: null,
            primary_path: projectPath,
            tags: [],
            integrations: {},
            metadata: {},
            last_opened_at: null,
            updated_at: "2026-08-10T00:00:00.000Z",
          });
        }
        if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}/events`) {
          return Response.json({ events: [] });
        }
        if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}/locations`) {
          return Response.json({ locations: [] });
        }
        if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}/agents`) {
          return Response.json({ assignments: [], count: 0 });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    const env = {
      HASNA_PROJECTS_HOME: root,
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${server.port}`,
      // Loopback credential through the canonical plain env tier. Tier 5 of the
      // shared @hasna/contracts ladder is LEGITIMATE and silent: with the
      // Keychain and disk tiers hushed by testSpawnEnv() it resolves cleanly
      // and prints nothing, so stderr-clean assertions hold.
      HASNA_PROJECTS_API_KEY: "not-a-secret",
    };

    try {
      const present = await runProjects(["context", projectPath, "--json"], env);
      expect(present.exitCode).toBe(0);
      expect(text(present.stderr)).toBe("");
      const presentJson = JSON.parse(text(present.stdout)) as {
        target: { input: string; resolved: boolean; source: string };
        project?: { id: string; slug: string; primary_path: string };
      };
      expect(presentJson.target).toEqual({ input: projectPath, resolved: true, source: "path" });
      expect(presentJson.project).toMatchObject({
        id: projectId,
        slug: "cli-context-path",
        primary_path: projectPath,
      });
      expect(requests.some((request) => request === `GET /v1/projects/${projectId}`)).toBe(true);

      const requestsBeforeAbsent = requests.length;
      const absent = await runProjects(["context", absentPath, "--json"], env);
      expect(absent.exitCode).toBe(0);
      expect(text(absent.stderr)).toBe("");
      expect(JSON.parse(text(absent.stdout))).toMatchObject({
        target: { input: absentPath, resolved: false, source: "none" },
      });
      expect(requests).toHaveLength(requestsBeforeAbsent);
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
