import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, listAuditEvents } from "../src/db/index.js";
import { routePlannerTool } from "../src/agent/capability-router.js";
import { evaluateFleetTransport } from "../src/agent/fleet-transport.js";
import type { SafetyConfig } from "../src/types/index.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-router-"));
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = join(tempDir, "computer.db");
}

afterEach(() => {
  closeDb();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

const SAFETY: SafetyConfig = {
  blockedApps: ["Keychain Access"],
  blockedDomains: ["bank.example.com"],
  confirmClicks: true,
  maxActionsPerMinute: 60,
  allowPasswordTyping: false,
};

describe("capability router", () => {
  test("rejects invalid planner input and writes a route audit row", async () => {
    useTempDb();
    const result = await routePlannerTool("computer", {
      action: "click",
      point: { x: -1, y: 1 },
    }, { safety: SAFETY });

    expect(result.status).toBe("invalid");
    expect(result.allowed).toBe(false);
    expect(listAuditEvents({ transport: "planner", capability: "planner.computer", limit: 1 })[0]?.decision).toBe("invalid");
  });

  test("routes computer actions through the action policy facade", async () => {
    useTempDb();
    const result = await routePlannerTool("computer", {
      action: "open_url",
      url: "https://bank.example.com/login",
    }, { safety: SAFETY });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("Blocked domain");
    expect(listAuditEvents({ transport: "planner", capability: "computer.open_url", limit: 5 })
      .some((event) => event.event === "action.policy_decision" && event.decision === "blocked")).toBe(true);
  });

  test("routes terminal tools through terminal policy and redacts command text", async () => {
    useTempDb();
    const marker = `router_terminal_${Date.now()}`;
    const result = await routePlannerTool("terminal", {
      dir: process.cwd(),
      commands: [`echo ${marker}`],
    }, { workspaceRoots: [process.cwd()] });

    expect(result.status).toBe("requires_confirmation");
    const events = listAuditEvents({ transport: "planner", capability: "terminal.exec", limit: 20 });
    expect(JSON.stringify(events)).not.toContain(marker);
    expect(events.some((event) => event.decision === "requires_confirmation")).toBe(true);
  });

  test("routes browser, fleet, storage, and memory capability classes", async () => {
    useTempDb();

    expect((await routePlannerTool("browser", { action: "status" })).status).toBe("allowed");
    expect((await routePlannerTool("browser", { action: "navigate", url: "https://example.com" })).status).toBe("requires_confirmation");
    expect((await routePlannerTool("fleet", { machineId: "machine-06484d2de7", action: "route" })).status).toBe("allowed");
    expect((await routePlannerTool("fleet", { machineId: "machine-06484d2de7", action: "run_smoke", workspacePath: process.cwd() })).status).toBe("requires_confirmation");
    expect((await routePlannerTool("storage", { action: "status" })).status).toBe("allowed");
    expect((await routePlannerTool("storage", { action: "sync" })).status).toBe("requires_confirmation");

    const memory = await routePlannerTool("memory", {
      scope: "goal",
      title: "Decision",
      body: "Private body should be redacted in audit",
    });
    expect(memory.status).toBe("allowed");
    expect(JSON.stringify(listAuditEvents({ transport: "planner", capability: "memory.record", limit: 5 })))
      .not.toContain("Private body");
  });

  test("redacts browser route audit URLs and session identifiers", async () => {
    useTempDb();
    const sessionId = "browser-session-secret-001";
    await routePlannerTool("browser", {
      action: "navigate",
      sessionId,
      url: "https://alice:hunter2@example.test/pay/checkout?token=abc123&query=ok",
    });

    const audits = listAuditEvents({ transport: "planner", capability: "browser.navigate", limit: 5 });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain(sessionId);
    expect(serialized).toContain("%3Credacted%3E");
    expect(audits[0]?.action_data).toEqual(expect.objectContaining({
      action: "navigate",
      has_session_id: true,
      redacted: true,
    }));
  });

  test("fleet mutations still fail closed after approval unless secure transport is bound", async () => {
    useTempDb();
    const input = { machineId: "machine-sensitive-001", action: "run_smoke" as const, workspacePath: process.cwd() };
    const verifyFleetCapabilityToken = (claims: {
      token: string;
      machineId: string;
      action: string;
      transportKind: string;
      artifact?: { namespace: string };
    }) => ({
      ok: claims.token === "capability-token"
        && claims.machineId === input.machineId
        && claims.action === input.action
        && claims.transportKind.length > 0,
      reason: "test verifier rejected token",
    });

    const missingTransport = await routePlannerTool("fleet", input, { approved: true });
    expect(missingTransport.status).toBe("blocked");
    expect(missingTransport.reason).toContain("explicit secure fleet transport");

    const missingToken = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "open-machines-cli-ssh",
        auth: "ssh-agent",
        machineId: input.machineId,
        explicitOptIn: true,
      },
    });
    expect(missingToken.status).toBe("blocked");
    expect(missingToken.reason).toContain("capability token");

    const insecureHttp = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "open-machines-mcp-http",
        auth: "api-key",
        machineId: input.machineId,
        explicitOptIn: true,
        capabilityToken: "capability-token",
        endpoint: "http://remote.example:8883/mcp",
      },
    });
    expect(insecureHttp.status).toBe("blocked");
    expect(insecureHttp.reason).toContain("HTTPS");

    const unverifiedToken = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "open-machines-cli-ssh",
        auth: "ssh-agent",
        machineId: input.machineId,
        explicitOptIn: true,
        capabilityToken: "capability-token",
      },
    });
    expect(unverifiedToken.status).toBe("blocked");
    expect(unverifiedToken.reason).toContain("verified machine/action capability token");

    const allowed = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "open-machines-cli-ssh",
        auth: "ssh-agent",
        machineId: input.machineId,
        explicitOptIn: true,
        capabilityToken: "capability-token",
      },
      verifyFleetCapabilityToken,
    });
    expect(allowed.status).toBe("allowed");

    const allowedLoopbackMcp = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "open-machines-mcp-http",
        auth: "api-key",
        machineId: input.machineId,
        explicitOptIn: true,
        capabilityToken: "capability-token",
        endpoint: "http://127.0.0.1:8821/mcp",
      },
      verifyFleetCapabilityToken,
    });
    expect(allowedLoopbackMcp.status).toBe("allowed");

    const prematureMtls = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "open-machines-mcp-http",
        auth: "mtls",
        machineId: input.machineId,
        explicitOptIn: true,
        capabilityToken: "capability-token",
        endpoint: "https://machines.example/mcp",
      },
      verifyFleetCapabilityToken,
    });
    expect(prematureMtls.status).toBe("blocked");
    expect(prematureMtls.reason).toContain("mTLS is reserved");

    const residentMissingEndpoint = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "resident-agent",
        auth: "api-key",
        machineId: input.machineId,
        explicitOptIn: true,
        capabilityToken: "capability-token",
      },
      verifyFleetCapabilityToken,
    });
    expect(residentMissingEndpoint.status).toBe("blocked");
    expect(residentMissingEndpoint.reason).toContain("valid endpoint");

    const residentPlainHttp = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: {
        kind: "resident-agent",
        auth: "api-key",
        machineId: input.machineId,
        explicitOptIn: true,
        capabilityToken: "capability-token",
        endpoint: "http://remote.example/agent",
      },
      verifyFleetCapabilityToken,
    });
    expect(residentPlainHttp.status).toBe("blocked");
    expect(residentPlainHttp.reason).toContain("HTTPS");

    const audits = listAuditEvents({ transport: "planner", capability: "fleet.run_smoke", limit: 10 });
    expect(JSON.stringify(audits)).not.toContain("machine-sensitive-001");
    expect(JSON.stringify(audits)).not.toContain("capability-token");
    expect(audits[0]?.metadata).toEqual(expect.objectContaining({
      fleet_transport: expect.objectContaining({
        capability_token_present: true,
        explicit_opt_in: true,
        machine_binding: true,
      }),
    }));
  });

  test("routes fleet artifact pulls through materialization approval and redacted audit", async () => {
    useTempDb();
    const input = {
      machineId: "machine-sensitive-artifact-001",
      action: "pull_artifact" as const,
      artifactId: "reports/run-summary.json",
      mode: "hash_only" as const,
      maxBytes: 2048,
    };
    const transport = {
      kind: "open-machines-cli-ssh" as const,
      auth: "ssh-agent" as const,
      machineId: input.machineId,
      explicitOptIn: true,
      capabilityToken: "capability-token",
    };
    const verifyFleetCapabilityToken = (claims: {
      token: string;
      machineId: string;
      action: string;
      transportKind: string;
      artifact?: {
        namespace: string;
        sourceScope: string;
        mode: string;
        maxBytes: number;
        expectedSha256?: string;
      };
    }) => ({
      ok: claims.token === "capability-token"
        && claims.machineId === input.machineId
        && claims.action === input.action
        && claims.transportKind === "open-machines-cli-ssh"
        && claims.artifact?.namespace === "reports"
        && claims.artifact.sourceScope === "run_artifact"
        && claims.artifact.maxBytes === input.maxBytes,
      reason: "test verifier rejected token",
    });

    const hashOnly = await routePlannerTool("fleet", input, {
      approved: true,
      fleetTransport: transport,
      verifyFleetCapabilityToken,
    });
    expect(hashOnly.status).toBe("allowed");

    const expectedSha256 = "a".repeat(64);
    const materializeInput = {
      ...input,
      mode: "materialize" as const,
      sourceScope: "run_artifact" as const,
      expectedSha256,
    };
    const missingArtifactApproval = await routePlannerTool("fleet", materializeInput, {
      approved: true,
      fleetTransport: transport,
      verifyFleetCapabilityToken,
    });
    expect(missingArtifactApproval.status).toBe("requires_confirmation");
    expect(missingArtifactApproval.reason).toContain("Materialized fleet artifact pulls require");

    const mismatchedArtifactApproval = await routePlannerTool("fleet", materializeInput, {
      approved: true,
      fleetTransport: transport,
      verifyFleetCapabilityToken,
      artifactPullApproval: {
        approved: true,
        machineId: input.machineId,
        artifactId: "reports/other.json",
        sourceScope: "run_artifact",
        expectedSha256,
        maxBytes: input.maxBytes,
      },
    });
    expect(mismatchedArtifactApproval.status).toBe("blocked");
    expect(mismatchedArtifactApproval.reason).toContain("does not match");

    const materialized = await routePlannerTool("fleet", materializeInput, {
      approved: true,
      fleetTransport: transport,
      verifyFleetCapabilityToken,
      artifactPullApproval: {
        approved: true,
        machineId: input.machineId,
        artifactId: input.artifactId,
        sourceScope: "run_artifact",
        expectedSha256,
        maxBytes: input.maxBytes,
      },
    });
    expect(materialized.status).toBe("allowed");

    const invalidPrivateName = await routePlannerTool("fleet", {
      machineId: input.machineId,
      action: "pull_artifact",
      artifactId: "screenshots/.ssh/id_rsa",
    });
    expect(invalidPrivateName.status).toBe("invalid");

    const serialized = JSON.stringify(listAuditEvents({ limit: 30 }));
    expect(serialized).not.toContain(input.machineId);
    expect(serialized).not.toContain(input.artifactId);
    expect(serialized).not.toContain("id_rsa");
    expect(serialized).not.toContain(expectedSha256);
    expect(serialized).toContain("artifact_namespace");
    expect(serialized).toContain("materialize_approval_bound");
  });

  test("fleet transport evaluator rejects unparsed unsafe artifact pulls", () => {
    const unsafe = evaluateFleetTransport({
      machineId: "machine-sensitive-artifact-001",
      action: "pull_artifact",
      artifactId: "../secret",
      timeoutMs: 15000,
    } as any, {
      approved: true,
      fleetTransport: {
        kind: "open-machines-cli-ssh",
        auth: "ssh-agent",
        machineId: "machine-sensitive-artifact-001",
        explicitOptIn: true,
        capabilityToken: "capability-token",
      },
      verifyCapabilityToken: () => true,
    });

    expect(unsafe.status).toBe("blocked");
    expect(unsafe.reason).toContain("canonical artifact contract");
  });
});
