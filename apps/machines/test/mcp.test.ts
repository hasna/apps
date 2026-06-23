import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MACHINE_MCP_TOOL_NAMES, createMcpServer } from "../src/mcp/server.js";
import {
  MUTATION_APPROVAL_FLAG_ENV,
  MUTATION_APPROVAL_TOKEN_ENV,
  createMutationApprovalToken,
} from "../src/commands/mutation-approval.js";
import {
  clearMachineFriendlyNameMutationArgs,
  machineFriendlyNameResourceId,
  manifestAdd,
  manifestInit,
  setMachineFriendlyNameMutationArgs,
} from "../src/commands/manifest.js";

afterEach(() => {
  delete process.env["HASNA_MACHINES_ALLOW_MUTATIONS"];
  delete process.env["HASNA_MACHINES_MUTATION_APPROVAL"];
  delete process.env["HASNA_MACHINES_MUTATION_TOKEN"];
  delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
  delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
  delete process.env["HASNA_MACHINES_DB_PATH"];
  delete process.env["HASNA_MACHINES_DATABASE_URL"];
  delete process.env["MACHINES_DATABASE_URL"];
  delete process.env["HASNA_MACHINES_MUTATION_REPLAY_PATH"];
});

test("exports expected MCP tool surface", () => {
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_doctor");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_self_test");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_apps_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_install_claude_diff");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_notifications_dispatch");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_webhooks_add");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_events_emit");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_serve_info");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_sync_apply");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_compatibility");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_route_resolve");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_workspace_resolve");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_friendly_name_get");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_friendly_name_set");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_friendly_name_clear");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_details");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_notes_context");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_notes_trash_policies");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_daemon_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_daemon_service_plan");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_push");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_pull");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_sync");
  expect(MACHINE_MCP_TOOL_NAMES).not.toContain("events");
  expect(MACHINE_MCP_TOOL_NAMES).not.toContain("hasna_events");
  expect(MACHINE_MCP_TOOL_NAMES).not.toContain("webhooks");
  expect(MACHINE_MCP_TOOL_NAMES.filter((name) => /^(events|hasna_events|webhooks)(_|$)/.test(name))).toEqual([]);
  expect(createMcpServer("0.0.1")).toBeDefined();
});

test("MCP mutation tools reject caller-supplied yes without operator approval", async () => {
  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mutation-approval-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    let failureText = "";
    try {
      const result = await client.callTool({
        name: "machines_apps_apply",
        arguments: { yes: true },
      });
      failureText = JSON.stringify(result);
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error);
    }
    expect(failureText).toContain("requires operator approval");
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP mutation tools reject global flags and static tokens", async () => {
  process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
  process.env[MUTATION_APPROVAL_TOKEN_ENV] = "secret";
  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mutation-static-token-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    let failureText = "";
    try {
      const result = await client.callTool({
        name: "machines_manifest_remove",
        arguments: { machine_id: "demo-node-01", approval_token: "secret" },
      });
      failureText = JSON.stringify(result);
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error);
    }
    expect(failureText).toContain("scoped approval_token");
    expect(failureText).not.toContain("secret");
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP mutation tools accept scoped tokens only for the exact operation and machine", async () => {
  process.env[MUTATION_APPROVAL_TOKEN_ENV] = "secret";
  process.env["HASNA_MACHINES_MANIFEST_PATH"] = `${process.env.TMPDIR ?? "/tmp"}/machines-mcp-scoped-${Date.now()}.json`;
  const token = createMutationApprovalToken({
    surface: "mcp",
        operation: "machines_manifest_remove",
        machineId: "demo-node-01",
        callerId: "mcp",
        runId: "mcp",
        transport: "mcp:stdio",
        args: { machine_id: "demo-node-01" },
      }, { env: process.env, now: Date.now(), nonce: "mcp-scoped" });
  const wrongMachineToken = createMutationApprovalToken({
    surface: "mcp",
    operation: "machines_manifest_remove",
    machineId: "other-node",
    callerId: "mcp",
    runId: "mcp",
    transport: "mcp:stdio",
    args: { machine_id: "demo-node-01" },
  }, { env: process.env, now: Date.now(), nonce: "mcp-wrong-machine" });
  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mutation-scoped-token-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    let failureText = "";
    try {
      const result = await client.callTool({
        name: "machines_manifest_remove",
        arguments: { machine_id: "demo-node-01", approval_token: wrongMachineToken },
      });
      failureText = JSON.stringify(result);
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error);
    }
    expect(failureText).toContain("requires operator approval");
    expect(failureText).not.toContain(wrongMachineToken);

    const result = await client.callTool({
      name: "machines_manifest_remove",
      arguments: { machine_id: "demo-node-01", approval_token: token },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(text)).toMatchObject({ version: 1, machines: [] });
  } finally {
    await client.close();
    await server.close();
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
  }
});

test("MCP friendly-name tools use scoped approvals and topology pagination", async () => {
  const dir = mkdtempSync(join(tmpdir(), "machines-mcp-friendly-name-"));
  process.env[MUTATION_APPROVAL_TOKEN_ENV] = "secret";
  process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
  process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
  process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-02";
  manifestInit();
  for (let index = 0; index < 12; index += 1) {
    manifestAdd({
      id: `demo-node-${String(index).padStart(2, "0")}`,
      platform: "linux" as const,
      workspacePath: `/workspace/${index}`,
      updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    });
  }

  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "friendly-name-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    let failureText = "";
    try {
      const result = await client.callTool({
        name: "machines_friendly_name_set",
        arguments: { machine_id: "demo-node-11", friendly_name: "Studio Linux" },
      });
      failureText = JSON.stringify(result);
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error);
    }
    expect(failureText).toContain("requires operator approval");

    const setInput = { machineId: "demo-node-11", friendlyName: "Studio Linux" };
    const setToken = createMutationApprovalToken({
      surface: "mcp",
      operation: "machines_friendly_name_set",
      machineId: setInput.machineId,
      resourceId: machineFriendlyNameResourceId(setInput.machineId),
      callerId: "mcp",
      runId: "mcp",
      transport: "mcp:stdio",
      args: setMachineFriendlyNameMutationArgs(setInput),
    }, { env: process.env, now: Date.now(), nonce: "mcp-friendly-name-set" });
    const set = await client.callTool({
      name: "machines_friendly_name_set",
      arguments: { machine_id: setInput.machineId, friendly_name: setInput.friendlyName, approval_token: setToken },
    });
    const setText = (set.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(setText)).toMatchObject({
      machine_id: "demo-node-11",
      friendly_name: "Studio Linux",
      display_name: "Studio Linux",
    });

    const topology = await client.callTool({
      name: "machines_topology",
      arguments: { include_tailscale: false, limit: 1 },
    });
    const topologyText = (topology.content as Array<{ type: string; text: string }>)[0]?.text;
    const topologyPayload = JSON.parse(topologyText);
    expect(topologyPayload.pagination).toMatchObject({
      limit: 1,
      total: 12,
      count: 1,
      hasMore: true,
      nextOffset: 1,
    });
    expect(topologyPayload.machines[0]).toMatchObject({
      machine_id: "demo-node-11",
      friendly_name: "Studio Linux",
      display_name: "Studio Linux",
    });

    let zeroLimitFailure = "";
    try {
      const result = await client.callTool({
        name: "machines_topology",
        arguments: { include_tailscale: false, limit: 0 },
      });
      zeroLimitFailure = JSON.stringify(result);
    } catch (error) {
      zeroLimitFailure = error instanceof Error ? error.message : String(error);
    }
    expect(zeroLimitFailure).toContain("Number must be greater than or equal to 1");

    const clearInput = { machineId: setInput.machineId };
    const clearToken = createMutationApprovalToken({
      surface: "mcp",
      operation: "machines_friendly_name_clear",
      machineId: clearInput.machineId,
      resourceId: machineFriendlyNameResourceId(clearInput.machineId),
      callerId: "mcp",
      runId: "mcp",
      transport: "mcp:stdio",
      args: clearMachineFriendlyNameMutationArgs(clearInput),
    }, { env: process.env, now: Date.now(), nonce: "mcp-friendly-name-clear" });
    const cleared = await client.callTool({
      name: "machines_friendly_name_clear",
      arguments: { machine_id: clearInput.machineId, approval_token: clearToken },
    });
    const clearedText = (cleared.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(clearedText)).toMatchObject({
      machine_id: "demo-node-11",
      friendly_name: null,
      display_name: "demo-node-11",
    });
  } finally {
    await client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP note contract tools expose provenance and trash metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "machines-mcp-notes-"));
  process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
  process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
  process.env["HASNA_MACHINES_MACHINE_ID"] = "origin-node";
  manifestInit();
  manifestAdd({
    id: "origin-node",
    friendlyName: "Desk Mac",
    platform: "macos",
    workspacePath: "/Users/hasna/Workspace",
    updatedAt: "2026-06-20T00:00:00.000Z",
  });
  manifestAdd({
    id: "agent-node",
    friendlyName: "Agent Box",
    platform: "linux",
    workspacePath: "/srv/workspace",
    updatedAt: "2026-06-21T00:00:00.000Z",
    metadata: {
      notesTrash: {
        enabled: true,
        retentionDays: 21,
        deleteAfterDays: 42,
        trashPath: "/srv/notes/.trash",
      },
    },
  });

  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "notes-contract-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const contextResult = await client.callTool({
      name: "machines_notes_context",
      arguments: {
        origin_machine_id: "origin-node",
        source_machine_id: "agent-node",
        target_machine_id: "missing-target",
        sync_target_machine_ids: ["missing-target"],
        actor_type: "agent",
        agent_id: "notes-agent",
        agent_name: "Notes Agent",
        source: "agent",
      },
    });
    const contextText = (contextResult.content as Array<{ type: string; text: string }>)[0]?.text;
    const context = JSON.parse(contextText);
    expect(context.origin_machine).toMatchObject({ machine_id: "origin-node", display_name: "Desk Mac" });
    expect(context.source_machine).toMatchObject({ machine_id: "agent-node", display_name: "Agent Box" });
    expect(context.target_machine).toMatchObject({ machine_id: "missing-target", known: false });
    expect(context.actor).toMatchObject({ actor_type: "agent", display_name: "Notes Agent" });

    const detailsResult = await client.callTool({
      name: "machines_details",
      arguments: { machine_id: "origin-node", include_tailscale: false },
    });
    const detailsText = (detailsResult.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(detailsText)).toMatchObject({
      machine_id: "origin-node",
      friendly_name: "Desk Mac",
      display_name: "Desk Mac",
      status: {
        state: "unknown",
        label: "Unknown",
        online: null,
      },
    });

    const trashResult = await client.callTool({
      name: "machines_notes_trash_policies",
      arguments: { machine_id: "agent-node" },
    });
    const trashText = (trashResult.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(trashText).policies[0]).toMatchObject({
      machine_id: "agent-node",
      display_name: "Agent Box",
      enabled: true,
      retention_days: 21,
      delete_after_days: 42,
      trash_path: "/srv/notes/.trash",
    });
  } finally {
    await client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP mutation tokens reject same-resource notification argument tampering", async () => {
  const dir = mkdtempSync(join(tmpdir(), "machines-mcp-args-hash-"));
  process.env[MUTATION_APPROVAL_TOKEN_ENV] = "secret";
  process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
  const token = createMutationApprovalToken({
    surface: "mcp",
    operation: "machines_notifications_add",
    resourceId: "notification:ops",
    callerId: "mcp",
    runId: "mcp",
    transport: "mcp:stdio",
    args: {
      channel_id: "ops",
      type: "email",
      target: "ops@example.com",
      command_args: [],
      events: ["manual.test"],
      enabled: true,
    },
  }, { env: process.env, now: Date.now(), nonce: "mcp-notification-args" });
  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mutation-args-hash-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    let failureText = "";
    try {
      const result = await client.callTool({
        name: "machines_notifications_add",
        arguments: {
          channel_id: "ops",
          type: "command",
          target: "/bin/sh",
          command_args: ["-c", "printf pwned"],
          events: ["manual.test"],
          enabled: true,
          approval_token: token,
        },
      });
      failureText = JSON.stringify(result);
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error);
    }
    expect(failureText).toContain("requires operator approval");
    expect(failureText).not.toContain(token);

    const result = await client.callTool({
      name: "machines_notifications_add",
      arguments: {
        channel_id: "ops",
        type: "email",
        target: "ops@example.com",
        command_args: [],
        events: ["manual.test"],
        enabled: true,
        approval_token: token,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(text).channels[0]).toMatchObject({ id: "ops", type: "email", target: "ops@example.com" });
  } finally {
    await client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP apps apply tokens are bound to the approved plan digest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "machines-mcp-plan-digest-"));
  process.env[MUTATION_APPROVAL_TOKEN_ENV] = "secret";
  process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
  process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
  process.env["HASNA_MACHINES_MUTATION_REPLAY_PATH"] = "";
  manifestInit();
  const machine = {
    id: "demo-node-apply",
    platform: "linux" as const,
    workspacePath: "/tmp/machines-mcp-plan-digest",
    apps: [],
  };
  manifestAdd(machine);

  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mutation-plan-digest-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const planResult = await client.callTool({
      name: "machines_apps_plan",
      arguments: { machine_id: "demo-node-apply" },
    });
    const planText = (planResult.content as Array<{ type: string; text: string }>)[0]?.text;
    const planDigest = JSON.parse(planText).planDigest;
    expect(planDigest).toMatch(/^[a-f0-9]{64}$/);
    const token = createMutationApprovalToken({
      surface: "mcp",
      operation: "machines_apps_apply",
      machineId: "demo-node-apply",
      resourceId: `plan:machines_apps_apply:demo-node-apply:${planDigest}`,
      callerId: "mcp",
      runId: "mcp",
      transport: "mcp:stdio",
      args: { machine_id: "demo-node-apply", yes: true, plan_digest: planDigest },
    }, { env: process.env, now: Date.now(), nonce: "mcp-apps-plan-digest" });

    const applied = await client.callTool({
      name: "machines_apps_apply",
      arguments: { machine_id: "demo-node-apply", yes: true, approval_token: token },
    });
    const appliedText = (applied.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(appliedText)).toMatchObject({ machineId: "demo-node-apply", mode: "apply", executed: 0, planDigest });

    manifestAdd({
      ...machine,
      apps: [{ name: "drifted-custom", manager: "custom" as const, packageName: "printf mcp-plan-drift-executed" }],
    });
    let failureText = "";
    try {
      const result = await client.callTool({
        name: "machines_apps_apply",
        arguments: { machine_id: "demo-node-apply", yes: true, approval_token: token },
      });
      failureText = JSON.stringify(result);
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error);
    }
    expect(failureText).toContain("requires operator approval");
    expect(failureText).not.toContain(token);
    expect(failureText).not.toContain("mcp-plan-drift-executed");
  } finally {
    await client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP storage tools hand off approved mutations to the storage layer", async () => {
  process.env[MUTATION_APPROVAL_TOKEN_ENV] = "secret";
  delete process.env["HASNA_MACHINES_DATABASE_URL"];
  delete process.env["MACHINES_DATABASE_URL"];
  const tables = ["agent_heartbeats"];
  const token = createMutationApprovalToken({
    surface: "mcp",
    operation: "storage_push",
    resourceId: "storage-push:agent_heartbeats",
    callerId: "mcp",
    runId: "mcp",
    transport: "mcp:stdio",
    args: { tables },
  }, { env: process.env, now: Date.now(), nonce: "mcp-storage-approved-handoff" });
  const server = createMcpServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "storage-approved-handoff-test", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    let failureText = "";
    try {
      const result = await client.callTool({
        name: "storage_push",
        arguments: { tables, approval_token: token },
      });
      failureText = JSON.stringify(result);
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error);
    }
    expect(failureText).toContain("Missing HASNA_MACHINES_DATABASE_URL");
    expect(failureText).not.toContain("sdk.machines_storage_push requires");
  } finally {
    await client.close();
    await server.close();
  }
});
