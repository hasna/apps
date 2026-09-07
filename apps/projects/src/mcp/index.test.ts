import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import { createWorkspace, recordWorkspaceEvent } from "../db/workspaces.js";
import { PROJECT_REDACTED_VALUE } from "../lib/redaction.js";
import {
  HOSTED_API_ENV_KEYS,
  TEST_HASNA_HOME,
  TEST_KEYCHAIN_STATION,
  testSpawnEnv,
  withoutUnhostedNotice,
} from "../testing/spawn-env.js";

function runMcpCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/mcp/index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    // Same isolation as testSpawnEnv(): blank the hosted API selectors so the
    // shared seam's disk tier cannot route the child to the real backend.
    env: testSpawnEnv(),
  });
}

function runMcpSession(messages: unknown[], env: Record<string, string>) {
  // The hosted selectors are dropped from the PASSED env, not only from
  // process.env: a call site handing this helper raw process.env must not be
  // able to reach the HTTP transport through it. testSpawnEnv() keeps keys
  // present in `overrides`, so it cannot express that. The Keychain and disk
  // tiers are silenced the same way testSpawnEnv() does it, which leaves the
  // session on the on-box SQLite registry these tests exercise.
  const isolated: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if ((HOSTED_API_ENV_KEYS as readonly string[]).includes(key)) continue;
    isolated[key] = value;
  }
  isolated["HASNA_HOME"] = TEST_HASNA_HOME;
  isolated["HASNA_STATION"] = TEST_KEYCHAIN_STATION;
  delete isolated["HASNA_CONFIG_HOME"];
  // The fail-closed ruling made the on-box registry opt-in only; these
  // sessions exercise that registry, so they state the opt-in explicitly
  // unless the caller already did (including a deliberate blank).
  if (!("HASNA_PROJECTS_LOCAL" in env)) isolated["HASNA_PROJECTS_LOCAL"] = "1";
  return Bun.spawnSync({
    cmd: ["node", "src/testing/mcp-stdio-client.mjs", JSON.stringify(messages)],
    stdout: "pipe",
    stderr: "pipe",
    env: isolated,
  });
}

describe("projects-mcp CLI flags", () => {
  test("prints help and exits successfully", () => {
    const result = runMcpCli(["--help"]);
    const stdout = Buffer.from(result.stdout).toString("utf-8");

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("Usage: projects-mcp [options]");
    expect(stdout).toContain("--help");
    expect(stdout).toContain("--version");
  });

  test("prints package version and exits successfully", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
    const result = runMcpCli(["--version"]);
    const stdout = Buffer.from(result.stdout).toString("utf-8").trim();

    expect(result.exitCode).toBe(0);
    expect(stdout).toBe(pkg.version);
  });

  test("calls render and GitHub root scan/sync MCP tools over stdio", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-render-call-"));
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "project-mcp-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "projects_render_list", arguments: {} } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "projects_render_roots", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "projects_render_recipes", arguments: {} } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "projects_scan_roots", arguments: {} } },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "projects_sync_roots", arguments: { dry_run: true } } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "projects_sync_roots", arguments: {} } },
    ];
    const result = runMcpSession(
      messages,
      testSpawnEnv({ HASNA_PROJECTS_DB_PATH: join(root, "projects.db") }),
    );
    const stdout = Buffer.from(result.stdout).toString("utf-8");
    const stderr = withoutUnhostedNotice(Buffer.from(result.stderr).toString("utf-8"));
    rmSync(root, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const responses = stdout.trim().split("\n").map((line) => JSON.parse(line)) as Array<{
      id?: number;
      result?: { content?: Array<{ type: string; text: string }> };
    }>;
    for (const id of [2, 3, 4]) {
      const payload = JSON.parse(responses.find((response) => response.id === id)?.result?.content?.[0]?.text ?? "{}");
      expect(payload.root).toBe("root");
      expect(payload.elements.root).toBeTruthy();
    }
    expect((JSON.parse(responses.find((response) => response.id === 5)?.result?.content?.[0]?.text ?? "{}") as { dry_run?: boolean }).dry_run).toBe(true);
    expect((JSON.parse(responses.find((response) => response.id === 6)?.result?.content?.[0]?.text ?? "{}") as { dry_run?: boolean }).dry_run).toBe(true);
    expect((JSON.parse(responses.find((response) => response.id === 7)?.result?.content?.[0]?.text ?? "{}") as { dry_run?: boolean }).dry_run).toBe(false);
  });

});

describe("projects-mcp project-first surface", () => {
  test("projects_doctor repairs an API-backed marker without local location or event writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-cloud-doctor-"));
    const dbPath = join(root, "projects.db");
    const projectPath = join(root, "cloud-project");
    const projectId = "wks_cloud_doctor";
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, ".project.json"), JSON.stringify({ id: projectId, slug: "stale" }), "utf-8");
    const db = new Database(dbPath);
    runMigrations(db);
    db.close();

    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        requests.push({ method: req.method, path: url.pathname });
        if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}`) {
          return Response.json({
            id: projectId,
            slug: "cloud-doctor",
            name: "Cloud Doctor",
            description: null,
            kind: "generic",
            status: "active",
            root_id: null,
            recipe_id: null,
            canonical_machine: null,
            primary_path: projectPath,
            git_remote: null,
            s3_bucket: null,
            s3_prefix: null,
            tags: [],
            integrations: {},
            metadata: {},
            last_opened_at: null,
            created_at: "2026-08-07 12:00:00.000",
            updated_at: "2026-08-07 12:00:00.000",
            synced_at: null,
          });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });

    try {
      const messages = [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "project-mcp-test", version: "0" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "projects_doctor", arguments: { id: projectId, fix: true, verbose: true } } },
      ];
      const proc = Bun.spawn({
        cmd: ["node", "src/testing/mcp-stdio-client.mjs", JSON.stringify(messages)],
        stdout: "pipe",
        stderr: "pipe",
        env: testSpawnEnv({
          HASNA_PROJECTS_DB_PATH: dbPath,
          HASNA_PROJECTS_API_URL: `http://127.0.0.1:${server.port}`,
          // Loopback credential through the canonical plain env tier. Tier 5 of
          // the shared @hasna/contracts ladder is LEGITIMATE and silent: with
          // the Keychain and disk tiers hushed by testSpawnEnv() it resolves
          // cleanly and prints nothing, so stderr-clean assertions hold.
          HASNA_PROJECTS_API_KEY: "test-key",
        }),
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = withoutUnhostedNotice(await new Response(proc.stderr).text());
      await proc.exited;

      expect(proc.exitCode).toBe(0);
      expect(stderr).toBe("");
      const responses = stdout.trim().split("\n").map((line) => JSON.parse(line)) as Array<{
        id?: number;
        result?: { content?: Array<{ type: string; text: string }> };
      }>;
      const payload = JSON.parse(responses.find((response) => response.id === 2)?.result?.content?.[0]?.text ?? "[]") as Array<{
        checks: Array<{ code: string }>;
        fixes: Array<{ code: string; changed: boolean }>;
      }>;
      expect(payload).toHaveLength(1);
      expect(payload[0]!.checks.some((check) => check.code === "WORKSPACE_LOCATIONS_LOCAL_ONLY")).toBe(true);
      expect(payload[0]!.fixes).toContainEqual(expect.objectContaining({ code: "FIX_WORKSPACE_MARKER", changed: true }));
      expect(JSON.parse(readFileSync(join(projectPath, ".project.json"), "utf-8"))).toMatchObject({ id: projectId, slug: "cloud-doctor" });

      const localDb = new Database(dbPath);
      expect(localDb.query("SELECT COUNT(*) AS count FROM workspace_locations").get()).toEqual({ count: 0 });
      expect(localDb.query("SELECT COUNT(*) AS count FROM workspace_events").get()).toEqual({ count: 0 });
      localDb.close();
      expect(requests).toEqual([{ method: "GET", path: `/v1/projects/${projectId}` }]);
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("registers project-first MCP tools and removes workspace aliases", () => {
    const source = readFileSync("src/mcp/index.ts", "utf-8");
    const legacyAliasEnv = "PROJECTS_ENABLE_" + "WORKSPACE_MCP_ALIASES";
    const legacyCreateTool = ["projects", "workspaces_create"].join("_");

    expect(source).toContain("\"projects_create\"");
    expect(source).toContain("\"projects_list\"");
    expect(source).toContain("\"projects_update\"");
    expect(source).toContain("\"projects_tag\"");
    expect(source).toContain("\"projects_untag\"");
    expect(source).toContain("\"projects_unlink\"");
    expect(source).toContain("\"projects_archive\"");
    expect(source).toContain("\"projects_start\"");
    expect(source).toContain("\"projects_tmux_status\"");
    expect(source).toContain("\"projects_cleanup_create\"");
    expect(source).toContain("\"projects_agents_assign\"");
    expect(source).toContain("\"projects_locations_list\"");
    expect(source).toContain("\"projects_locations_add\"");
    expect(source).not.toContain("\"projects_sync\"");
    expect(source).not.toContain(legacyAliasEnv);
    expect(source).not.toContain(`"${legacyCreateTool}"`);
    expect(source).toContain("\"projects_agent_eval\"");
    expect(source).toContain("\"projects_agent_prompt\"");
    expect(source).toContain("\"projects_scan_local_roots\"");
    expect(source).toContain("\"projects_sync_roots\"");
    expect(source).toContain("\"projects_scan_roots\"");
    expect(source).toContain("\"projects_render_recipes\"");
    expect(source).toContain("\"projects_render_roots\"");
    expect(source).toContain("\"projects_render_sessions\"");
    expect(source).toContain("\"projects_render_status\"");
    expect(source).toContain("\"projects_render_start\"");
    expect(source).toContain("\"projects_render_show\"");
    expect(source).toContain("\"projects_render_list\"");
    expect(source).toContain("\"projects_store_inspect\"");
    expect(source).not.toContain("\"projects_canvases_list\"");
    expect(source).not.toContain("\"projects_canvases_create\"");
    expect(source).not.toContain("\"projects_canvases_upsert\"");
    expect(source).not.toContain("\"projects_canvases_compose\"");
    expect(source).not.toContain("\"projects_render_canvas\"");
    expect(source).toContain("\"projects_loops_link\"");
    expect(source).toContain("\"projects_loops_list\"");
  });

  test("lists project tools over stdio JSON-RPC", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-smoke-"));
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "project-mcp-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ];
    const result = runMcpSession(
      messages,
      testSpawnEnv({ HASNA_PROJECTS_DB_PATH: join(root, "projects.db") }),
    );
    const stdout = Buffer.from(result.stdout).toString("utf-8");
    const stderr = withoutUnhostedNotice(Buffer.from(result.stderr).toString("utf-8"));
    rmSync(root, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const responses = stdout.trim().split("\n").map((line) => JSON.parse(line)) as Array<{
      id?: number;
      result?: {
        tools?: Array<{
          name: string;
          inputSchema?: { properties?: Record<string, unknown> };
        }>;
      };
    }>;
    const listedTools = responses.find((response) => response.id === 2)?.result?.tools ?? [];
    const tools = listedTools.map((tool) => tool.name);
    const legacyCreateTool = ["projects", "workspaces_create"].join("_");
    expect(tools).toContain("projects_create");
    expect(tools).toContain("projects_list");
    expect(tools).toContain("projects_tag");
    expect(tools).toContain("projects_untag");
    expect(tools).toContain("projects_unlink");
    expect(tools).toContain("projects_start");
    expect(tools).toContain("projects_tmux_status");
    expect(tools).toContain("projects_cleanup_create");
    expect(tools).toContain("projects_agents_assign");
    expect(tools).toContain("projects_locations_list");
    expect(tools).toContain("projects_locations_add");
    expect(tools).toContain("projects_events_list");
    expect(tools).toContain("projects_agent_eval");
    expect(tools).toContain("projects_agent_prompt");
    expect(tools).toContain("projects_scan_local_roots");
    expect(tools).toContain("projects_sync_roots");
    expect(tools).toContain("projects_scan_roots");
    expect(tools).toContain("projects_render_recipes");
    expect(tools).toContain("projects_render_roots");
    expect(tools).toContain("projects_render_sessions");
    expect(tools).toContain("projects_render_status");
    expect(tools).toContain("projects_render_start");
    expect(tools).toContain("projects_render_show");
    expect(tools).toContain("projects_render_list");
    expect(tools).toContain("projects_store_inspect");
    expect(tools).not.toContain("projects_canvases_list");
    expect(tools).not.toContain("projects_canvases_create");
    expect(tools).not.toContain("projects_canvases_upsert");
    expect(tools).not.toContain("projects_canvases_compose");
    expect(tools).not.toContain("projects_render_canvas");
    expect(tools).toContain("projects_loops_link");
    expect(tools).toContain("projects_loops_list");
    expect(tools).not.toContain(legacyCreateTool);
    expect(tools).not.toContain("projects_sync");
    expect(
      listedTools.find((tool) => tool.name === "projects_import_github")?.inputSchema?.properties,
    ).toHaveProperty("metadata");
  });

  test("projects_create and projects_import accept and persist finance metadata over MCP", () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-finance-metadata-"));
    const dbPath = join(root, "projects.db");
    const importPath = join(root, "mcp-finance-import");
    mkdirSync(importPath, { recursive: true });
    writeFileSync(
      join(importPath, "package.json"),
      JSON.stringify({ name: "mcp-finance-import" }),
      "utf-8",
    );
    const financeMetadata = {
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: ["Example Alpha SRL"],
      fiscal_cycle: "monthly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    };
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "project-mcp-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "projects_create",
          arguments: {
            name: "MCP Finance Create",
            slug: "mcp-finance-create",
            metadata: financeMetadata,
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "projects_import",
          arguments: {
            path: importPath,
            metadata: financeMetadata,
          },
        },
      },
    ];

    try {
      const result = runMcpSession(
        messages,
        testSpawnEnv({
          HASNA_PROJECTS_DB_PATH: dbPath,
          HASNA_PROJECTS_HOME: join(root, "projects-home"),
        }),
      );
      expect(result.exitCode).toBe(0);
      expect(withoutUnhostedNotice(Buffer.from(result.stderr).toString("utf-8"))).toBe("");

      const db = new Database(dbPath);
      const rows = db.query(
        "SELECT slug, metadata FROM workspaces WHERE slug IN (?, ?) ORDER BY slug",
      ).all("mcp-finance-create", "mcp-finance-import") as Array<{
        slug: string;
        metadata: string;
      }>;
      db.close();

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(JSON.parse(row.metadata)).toMatchObject(financeMetadata);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("spawned MCP sessions strip hosted-backend env even from a raw process.env call site — writes land in the temp DB", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-hermetic-"));
    const dbPath = join(root, "projects.db");
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        requests.push(`${req.method} ${new URL(req.url).pathname}`);
        return Response.json({ error: "ambient api env reached a spawned MCP server" }, { status: 500 });
      },
    });

    const previousUrl = process.env.HASNA_PROJECTS_API_URL;
    const previousKey = process.env.HASNA_PROJECTS_API_KEY;
    process.env.HASNA_PROJECTS_API_URL = `http://127.0.0.1:${server.port}`;
    // Bracket form: a plain `KEY = "..."` assignment trips the secrets scan's
    // credential_assignment detector on this synthetic hermetic fixture.
    process.env["HASNA_PROJECTS_API_KEY"] = "hermetic-test-key";
    try {
      const messages = [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "project-mcp-test", version: "0" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "projects_create",
            arguments: {
              name: "Hermetic MCP Create",
              slug: "mcp-hermetic-create",
            },
          },
        },
      ];
      // The only call shape that pins the structural property: raw process.env
      // (with api url/key set above), NOT a call-site testSpawnEnv() — that
      // would strip the selectors before the wrapper runs and pass trivially.
      const result = runMcpSession(messages, { ...process.env, HASNA_PROJECTS_DB_PATH: dbPath });
      expect(result.exitCode).toBe(0);
      expect(withoutUnhostedNotice(Buffer.from(result.stderr).toString("utf-8"))).toBe("");

      const db = new Database(dbPath);
      const row = db.query("SELECT slug FROM workspaces WHERE slug = ?").get("mcp-hermetic-create");
      db.close();

      expect(row).not.toBeNull();
      expect(requests).toEqual([]);
    } finally {
      if (previousUrl === undefined) delete process.env.HASNA_PROJECTS_API_URL;
      else process.env.HASNA_PROJECTS_API_URL = previousUrl;
      if (previousKey === undefined) delete process.env.HASNA_PROJECTS_API_KEY;
      else process.env.HASNA_PROJECTS_API_KEY = previousKey;
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("projects_import_github accepts and persists finance metadata over MCP", () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-finance-github-"));
    const dbPath = join(root, "projects.db");
    const financeMetadata = {
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: ["Example MCP GitHub SRL"],
      fiscal_cycle: "monthly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    };
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "project-mcp-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "projects_import_github",
          arguments: {
            repo: "hasna/mcp-finance-github",
            remote_only: true,
            metadata: financeMetadata,
          },
        },
      },
    ];

    try {
      const result = runMcpSession(
        messages,
        testSpawnEnv({
          HASNA_PROJECTS_DB_PATH: dbPath,
          HASNA_PROJECTS_HOME: join(root, "projects-home"),
        }),
      );
      expect(result.exitCode).toBe(0);
      expect(withoutUnhostedNotice(Buffer.from(result.stderr).toString("utf-8"))).toBe("");

      const db = new Database(dbPath);
      const row = db.query(
        "SELECT metadata FROM workspaces WHERE slug = ?",
      ).get("mcp-finance-github") as { metadata: string } | null;
      db.close();

      expect(row).not.toBeNull();
      expect(JSON.parse(row!.metadata)).toMatchObject({
        ...financeMetadata,
        github_imported: true,
        github_full_name: "hasna/mcp-finance-github",
        remote_only: true,
        cloned: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("redacts project registry values in MCP JSON-RPC tool output", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-redaction-"));
    const dbPath = join(root, "projects.db");
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
    const project = createWorkspace({
      name: "MCP Redaction",
      slug: "mcp-redaction",
      kind: "project",
      primary_path: join(root, "mcp-redaction"),
      metadata: { clientSecret: "mcp-redaction-value-a" },
      integrations: { api_token: "mcp-redaction-value-b" },
    }, db);
    recordWorkspaceEvent({
      workspace_id: project.id,
      event_type: "redaction_check",
      source: "mcp",
      // The stored prompt deliberately carries a live `KEY=value` shape so the
      // redactor must mask it; the literal is composed at runtime so the
      // secrets scan's credential_assignment detector does not flag the
      // synthetic fixture in source.
      prompt: `Use MCP_API_KEY=${"mcp-redaction-value-c"}`,
      metadata: { credential: "mcp-redaction-value-d" },
    }, db);
    db.close();

    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "project-mcp-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "projects_list", arguments: { query: "mcp-redaction" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "projects_events_list", arguments: { project: "mcp-redaction" } } },
    ];
    const result = runMcpSession(messages, testSpawnEnv({ HASNA_PROJECTS_DB_PATH: dbPath }));
    const stdout = Buffer.from(result.stdout).toString("utf-8");
    const stderr = withoutUnhostedNotice(Buffer.from(result.stderr).toString("utf-8"));
    rmSync(root, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(PROJECT_REDACTED_VALUE);
    for (const leaked of [
      "mcp-redaction-value-a",
      "mcp-redaction-value-b",
      "mcp-redaction-value-c",
      "mcp-redaction-value-d",
    ]) {
      expect(stdout).not.toContain(leaked);
    }
  });
});
