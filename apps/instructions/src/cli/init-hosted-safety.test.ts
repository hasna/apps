import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempRoot } from "../lib/test-temp-root.js";
import { PLATFORM_PROFILE_PRESETS } from "../lib/platform-profiles.js";
import type { Config, Profile } from "../types/index.js";

const packageRoot = join(import.meta.dir, "../..");
const stamp = "2026-01-01T00:00:00.000Z";
const standardSlugs = [
  "global-agent-rules-standard",
  "dangerous-operation-guard-standard",
  "codewith-shared-todos-storage-standard",
  "agent-managed-project-dashboard-standard",
];

function config(slug: string, overrides: Partial<Config> = {}): Config {
  return {
    id: `id-${slug}`, slug, name: slug, kind: "reference", category: "rules",
    agent: "global", target_path: null, outputs: [], format: "markdown",
    content: `Instruction fixture: ${slug}`, description: null, tags: [],
    is_template: false, version: 1, created_at: stamp, updated_at: stamp,
    synced_at: null, ...overrides,
  };
}

function fixtures(): Config[] {
  return [
    config("workspace-structure", { category: "workspace" }),
    config("secrets-schema", { category: "secrets_schema" }),
    // Existing retired standards must never be rewritten by their seed helpers.
    ...standardSlugs.map((slug) => config(slug, { tags: ["retired-global-source"] })),
    config("global-reviewed-rule"),
    config("private-project-rule", { agent: "claude", target_path: "~/private-project/AGENTS.md", tags: ["project:private-project"] }),
    config("retired-rule", { tags: ["retired-instruction-source"] }),
    config("native-settings", { tags: ["config-only"] }),
    config("mcp-settings", { category: "mcp", format: "json", content: '{"mcpServers":{}}' }),
    config("unresolved-template", { is_template: true, content: "Scope: {{PROJECT}}" }),
  ];
}

type Call = { method: string; path: string; body?: Record<string, unknown> };
type Options = { failPath?: string; failStatus?: number; existingProfiles?: boolean; missingProfile?: string };

async function runHostedInit(options: Options = {}) {
  const home = makeTempRoot("instructions-init-hosted-");
  const configs = fixtures();
  const profiles: Profile[] = options.existingProfiles ? [
    { id: "profile-my-setup", slug: "my-setup", name: "my-setup", description: null, selectors: {}, variables: {}, created_at: stamp, updated_at: stamp },
    ...PLATFORM_PROFILE_PRESETS.map((preset) => ({
      id: `profile-${preset.name}`, slug: preset.name, name: preset.name,
      description: preset.description ?? null, selectors: preset.selectors ?? {},
      variables: preset.variables ?? {}, created_at: stamp, updated_at: stamp,
    })),
  ] : [];
  if (options.missingProfile) {
    const index = profiles.findIndex((profile) => profile.slug === options.missingProfile);
    if (index >= 0) profiles.splice(index, 1);
  }
  const calls: Call[] = [];
  const unexpected: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/instructions\/v1/, "");
      const method = request.method;
      const body = method === "GET" ? undefined : await request.json() as Record<string, unknown>;
      calls.push({ method, path, body });
      if (path === options.failPath) return Response.json({ error: "synthetic hosted read failure" }, { status: options.failStatus ?? 403 });
      if (method === "GET" && path === "/configs") return Response.json({ configs, count: configs.length });
      if (method === "GET" && path.startsWith("/configs/")) {
        const row = configs.find((candidate) => candidate.slug === decodeURIComponent(path.slice(9)));
        return row ? Response.json({ config: row }) : Response.json({ error: "config not found" }, { status: 404 });
      }
      if (method === "GET" && path === "/profiles") return Response.json({ profiles, count: profiles.length });
      if (method === "GET" && path.startsWith("/profiles/")) {
        const key = decodeURIComponent(path.slice(10));
        const row = profiles.find((candidate) => candidate.slug === key || candidate.id === key);
        return row ? Response.json({ profile: row }) : Response.json({ error: "profile not found" }, { status: 404 });
      }
      if (method === "POST" && path === "/profiles") {
        const name = String(body!.name);
        const profile: Profile = {
          id: `profile-${name}`, slug: name, name, description: String(body!.description ?? ""),
          selectors: (body!.selectors ?? {}) as Profile["selectors"],
          variables: (body!.variables ?? {}) as Profile["variables"], created_at: stamp, updated_at: stamp,
        };
        profiles.push(profile);
        return Response.json({ profile }, { status: 201 });
      }
      if (method === "POST" && /^\/profiles\/[^/]+\/configs$/.test(path)) return Response.json({ added: true });
      if (method === "GET" && path === "/stats") return Response.json({ total: configs.length });
      unexpected.push(`${method} ${path}`);
      return Response.json({ error: "unexpected test request" }, { status: 400 });
    },
  });
  // This discoverable local source must not be imported during hosted init.
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "LOCAL_IMPORT_CANARY\n");
  const child = Bun.spawn([process.execPath, "src/cli/index.tsx", "init"], {
    cwd: packageRoot,
    env: {
      PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: home, USER: "synthetic-test",
      HASNA_INSTRUCTIONS_API_URL: `http://127.0.0.1:${server.port}/instructions`,
      HASNA_INSTRUCTIONS_API_KEY: "synthetic-hosted-init-test", NO_COLOR: "1", FORCE_COLOR: "0",
    },
    stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, calls, unexpected, profiles, configs };
  } finally {
    clearTimeout(timer);
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}

describe("hosted init source and failure boundaries", () => {
  test("creates empty defaults without importing local files or implicitly binding private/retired/configuration sources", async () => {
    const result = await runHostedInit();
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.unexpected).toEqual([]);
    expect(result.profiles.map((profile) => profile.slug).sort()).toEqual(["linux-arm64", "macos-arm64", "my-setup"]);
    // Eligibility alone is not scope authorization. Fresh defaults require explicit reviewed selection.
    expect(result.calls.filter((call) => call.method !== "GET").map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /profiles", "POST /profiles", "POST /profiles",
    ]);
    expect(result.calls.some((call) => JSON.stringify(call.body ?? {}).includes("LOCAL_IMPORT_CANARY"))).toBe(false);
  });

  test("retains existing profile memberships without implicit writes", async () => {
    const result = await runHostedInit({ existingProfiles: true });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  test("a genuinely absent platform profile is not created when the other platform lookup fails", async () => {
    const result = await runHostedInit({ existingProfiles: true, missingProfile: "linux-arm64", failPath: "/profiles/macos-arm64", failStatus: 403 });
    expect(result.exitCode).not.toBe(0);
    expect(result.calls.some((call) => call.path === "/profiles/linux-arm64")).toBe(true);
    expect(result.calls.some((call) => call.path === "/profiles/macos-arm64")).toBe(true);
    expect(result.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  test.each([
    ["/configs/workspace-structure", 401],
    ["/configs/secrets-schema", 403],
    ["/configs/workspace-structure", 500],
    ["/profiles/my-setup", 401],
    ["/profiles/my-setup", 500],
    ["/profiles/linux-arm64", 403],
    ["/profiles/macos-arm64", 500],
  ] as const)("read failure at %s (%s) cannot be mistaken for absence or trigger mutations", async (failPath, failStatus) => {
    const result = await runHostedInit({ failPath, failStatus, existingProfiles: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.calls.some((call) => call.path === failPath)).toBe(true);
    expect(result.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });
});
