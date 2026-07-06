import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { formatError } from "../src/mcp/index.js";
import { registerStorageTools } from "../src/mcp/tools/storage.js";
import { McpWriteConfirmationRequiredError, stripMcpWriteConfirmation } from "../src/mcp/schemas/index.js";
import { isMcpToolInProfile, OP_REGISTRY } from "../src/services/registry.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../src/services/authorization.js";
import {
  assertMcpServeSafety,
  checkMcpRateLimit,
  handleMcpHttpRequest,
  mcpAuthRequired,
  resetMcpRateLimit,
  resolveMcpBindHost,
} from "../src/mcp/http.js";
import type { McpToolResult } from "../src/mcp/compact.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

const mutatingToolsByFile: Record<string, string[]> = {
  "src/mcp/tools/members.ts": ["create_member", "update_member"],
  "src/mcp/tools/capabilities.ts": ["add_capability", "remove_capability"],
  "src/mcp/tools/lifecycle.ts": ["record_role_change"],
  "src/mcp/tools/assignments.ts": ["create_assignment", "end_assignment"],
};

type Handler = (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;

function captureStorageHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  registerStorageTools(
    { tool: (name: string, _d: string, _s: Record<string, unknown>, handler: Handler) => handlers.set(name, handler) },
    { authCtx: SYSTEM_AUTHORIZATION_CONTEXT, shouldRegisterTool: () => true, formatError },
  );
  return handlers;
}

describe("MCP write safety", () => {
  it("requires confirm: true and strips MCP-only fields before writes", () => {
    expect(() => stripMcpWriteConfirmation({}, "create_member")).toThrow(McpWriteConfirmationRequiredError);
    const clean = stripMcpWriteConfirmation({ confirm: true, confirmation_reason: "ok", idempotency_key: "k", name: "X" }, "create_member");
    expect(clean).toEqual({ name: "X" });
  });

  it("formats a missing confirmation as a structured error", () => {
    const payload = JSON.parse(formatError(new McpWriteConfirmationRequiredError("create_member")));
    expect(payload.code).toBe("MCP_CONFIRMATION_REQUIRED");
    expect(payload.suggestion).toContain("confirm: true");
  });

  it("keeps every mutating MCP tool behind the confirmation helper", () => {
    for (const [file, toolNames] of Object.entries(mutatingToolsByFile)) {
      const source = readFileSync(file, "utf8");
      for (const toolName of toolNames) {
        expect(source, `${toolName} exposes confirmation fields`).toContain("mcpWriteConfirmationSchema");
        expect(source, `${toolName} enforces confirmation`).toContain(`stripMcpWriteConfirmation(args, "${toolName}")`);
      }
    }
  });

  it("keeps destructive/mutating tools out of the minimal profile", () => {
    for (const op of OP_REGISTRY) {
      if (op.mutating && op.op !== "create_member") {
        expect(isMcpToolInProfile(op.surfaces.mcp, "minimal"), `${op.op} must not be in minimal`).toBe(false);
      }
    }
  });
});

describe("MCP transport auth", () => {
  it("requires auth on loopback by default and rejects unauthenticated /mcp", async () => {
    delete process.env["HASNA_WORKFORCE_MCP_AUTH"];
    delete process.env["HASNA_WORKFORCE_API_CREDENTIALS"];
    expect(mcpAuthRequired("127.0.0.1")).toBe(true);
    const res = await handleMcpHttpRequest(new Request("http://127.0.0.1/mcp", { method: "POST", body: "{}" }), "127.0.0.1");
    expect(res.status).toBe(401);
  });

  it("forces auth on for a non-loopback bind regardless of env", () => {
    process.env["HASNA_WORKFORCE_MCP_AUTH"] = "off";
    expect(mcpAuthRequired("0.0.0.0")).toBe(true);
    delete process.env["HASNA_WORKFORCE_MCP_AUTH"];
  });
});

describe("MCP transport fail-closed startup + bind host", () => {
  afterEach(() => {
    delete process.env["HASNA_WORKFORCE_MCP_BIND_HOST"];
    delete process.env["HASNA_WORKFORCE_API_CREDENTIALS"];
  });

  it("resolves the bind host from env, defaulting to loopback", () => {
    expect(resolveMcpBindHost()).toBe("127.0.0.1");
    process.env["HASNA_WORKFORCE_MCP_BIND_HOST"] = "0.0.0.0";
    expect(resolveMcpBindHost()).toBe("0.0.0.0");
  });

  it("refuses to start on a non-loopback bind with no credentials", () => {
    delete process.env["HASNA_WORKFORCE_API_CREDENTIALS"];
    expect(() => assertMcpServeSafety("0.0.0.0")).toThrow(/requires API credentials/);
  });

  it("allows a non-loopback bind once credentials are configured", () => {
    process.env["HASNA_WORKFORCE_API_CREDENTIALS"] = JSON.stringify([{ id: "c", token: "t" }]);
    expect(() => assertMcpServeSafety("0.0.0.0")).not.toThrow();
  });

  it("allows loopback in local mode without credentials", () => {
    delete process.env["HASNA_WORKFORCE_API_CREDENTIALS"];
    expect(() => assertMcpServeSafety("127.0.0.1")).not.toThrow();
  });
});

describe("MCP per-peer rate limiter", () => {
  afterEach(() => {
    resetMcpRateLimit();
    delete process.env["HASNA_WORKFORCE_MCP_RATE_LIMIT"];
  });

  it("limits a single peer within the window and isolates peers", () => {
    process.env["HASNA_WORKFORCE_MCP_RATE_LIMIT"] = "3";
    resetMcpRateLimit();
    expect(checkMcpRateLimit("1.2.3.4")).toBe(true);
    expect(checkMcpRateLimit("1.2.3.4")).toBe(true);
    expect(checkMcpRateLimit("1.2.3.4")).toBe(true);
    expect(checkMcpRateLimit("1.2.3.4")).toBe(false);
    // A different peer is unaffected — the limiter keys on the real socket peer.
    expect(checkMcpRateLimit("5.6.7.8")).toBe(true);
  });
});

describe("storage_status never leaks the DSN", () => {
  let dbPath: string;
  const secretDsn = "postgres://workforce:sup3r-s3cret-pw@db.internal:5432/workforce?sslmode=verify-full";

  beforeEach(() => {
    dbPath = useTestDatabase("storage");
  });
  afterEach(() => {
    delete process.env["HASNA_WORKFORCE_DATABASE_URL"];
    cleanupTestDatabase(dbPath);
  });

  it("reports dsn_present without emitting any DSN substring", async () => {
    process.env["HASNA_WORKFORCE_DATABASE_URL"] = secretDsn;
    const handlers = captureStorageHandlers();
    const result = await handlers.get("workforce_storage_status")!({});
    const text = result.content[0]!.text;
    expect(text).not.toContain("sup3r-s3cret-pw");
    expect(text).not.toContain(secretDsn);
    const parsed = JSON.parse(text);
    expect(parsed.dsn_present).toBe(true);
    expect(parsed).not.toHaveProperty("dsn");
    expect(parsed).not.toHaveProperty("database_url");
  });

  it("denies storage_push without an elevated scope", async () => {
    const handlers = captureStorageHandlers();
    // A non-elevated principal (no bypass, recruiter role).
    const restricted = new Map<string, Handler>();
    registerStorageTools(
      { tool: (name: string, _d: string, _s: Record<string, unknown>, handler: Handler) => restricted.set(name, handler) },
      { authCtx: { actor_id: "r", roles: ["recruiter"], org_ids: ["x"] }, shouldRegisterTool: () => true, formatError },
    );
    const denied = await restricted.get("workforce_storage_push")!({});
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0]!.text).code).toBe("PERMISSION_DENIED");
    // And an elevated (system bypass) caller is not denied by scope.
    const allowed = await handlers.get("workforce_storage_push")!({});
    expect(JSON.parse(allowed.content[0]!.text).code).toBeUndefined();
  });
});
