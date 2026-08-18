import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { EventsClient } from "@hasna/events";
import {
  clearMachineFriendlyNameMutationArgs,
  machineFriendlyNameResourceId,
  manifestAdd,
  manifestInit,
  setMachineFriendlyNameMutationArgs,
} from "../src/commands/manifest.js";
import { addNotificationChannel } from "../src/commands/notifications.js";
import { createMutationApprovalToken, mutationArgsSha256, MUTATION_APPROVAL_FLAG_ENV, MUTATION_APPROVAL_TOKEN_ENV } from "../src/commands/mutation-approval.js";
import { getServeInfo, renderDashboardHtml, startDashboardServer } from "../src/commands/serve.js";
import { upsertHeartbeat } from "../src/db.js";
import {
  projectAssignmentMutationArgs,
  projectAssignmentResourceId,
  removeProjectAssignmentMutationArgs,
  type AssignMachineProjectInput,
} from "../src/projects.js";
import { PRIVATE_OUTPUT_DENIED_WARNING } from "../src/redaction.js";

const dashboardMutationSecret = "serve-dashboard-test-secret";

function dashboardResourceId(kind: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  const values = parts
    .map((part) => String(part ?? "*").trim())
    .filter(Boolean)
    .join(":");
  return values ? `${kind}:${values}` : kind;
}

function eventStoreDir(dir: string): string {
  return resolve(join(dir, "events"));
}

function eventStoreResourceId(kind: string, dir: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  return dashboardResourceId(kind, mutationArgsSha256({ event_store_dir: eventStoreDir(dir) }), ...parts);
}

function withEventStoreScope(dir: string, args: Record<string, unknown>): Record<string, unknown> {
  return { event_store_dir: eventStoreDir(dir), ...args };
}

function dashboardToken(operation: string, resourceId: string, args: unknown): string {
  return createMutationApprovalToken({
    surface: "dashboard",
    operation,
    transport: "dashboard:http",
    callerId: "dashboard",
    runId: "dashboard",
    resourceId,
    args,
  }, { secret: dashboardMutationSecret });
}

function eventEmitApproval(dir: string, type: string, args: {
  source?: string;
  subject?: string;
  severity?: string;
  message?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
} = {}): string {
  const source = args.source ?? "machines";
  const data = args.data ?? {};
  const metadata = args.metadata ?? {};
  return dashboardToken("machines_events_emit", eventStoreResourceId("event", dir, type, args.subject, args.dedupeKey), withEventStoreScope(dir, {
    event_type: type,
    source,
    subject: args.subject,
    severity: args.severity,
    message: args.message,
    data,
    metadata,
    dedupe_key: args.dedupeKey,
    deliver: true,
    dedupe: true,
  }));
}

function notificationTestApproval(channelId: string, args: {
  event?: string;
  message?: string;
  apply?: boolean;
  yes?: boolean;
} = {}): string {
  const event = args.event ?? "manual.test";
  const message = args.message ?? "machines notification test";
  const apply = args.apply === true;
  const yes = args.yes === true;
  return dashboardToken("machines_notifications_test", dashboardResourceId("notification-test", channelId, event), {
    channel_id: channelId,
    event,
    message,
    apply,
    yes,
  });
}

function webhookTestApproval(dir: string, channelId: string, args: {
  type?: string;
  message?: string;
  data?: Record<string, unknown>;
} = {}): string {
  const type = args.type ?? "events.test";
  const subject = channelId;
  const message = args.message ?? "Hasna events test delivery";
  const data = args.data ?? {};
  return dashboardToken("machines_webhooks_test", eventStoreResourceId("webhook-test", dir, channelId, type), withEventStoreScope(dir, {
    channel_id: channelId,
    event_type: type,
    subject,
    message,
    data,
  }));
}

function projectAssignmentApproval(input: AssignMachineProjectInput): string {
  return createMutationApprovalToken({
    surface: "dashboard",
    operation: "machines_projects_assign",
    transport: "dashboard:http",
    callerId: "dashboard",
    runId: "dashboard",
    machineId: input.machineId,
    resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
    args: projectAssignmentMutationArgs(input),
  }, { secret: dashboardMutationSecret });
}

function projectAssignmentRemoveApproval(input: { machineId: string; projectId: string }): string {
  return createMutationApprovalToken({
    surface: "dashboard",
    operation: "machines_projects_unassign",
    transport: "dashboard:http",
    callerId: "dashboard",
    runId: "dashboard",
    machineId: input.machineId,
    resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
    args: removeProjectAssignmentMutationArgs(input),
  }, { secret: dashboardMutationSecret });
}

function friendlyNameSetApproval(input: { machineId: string; friendlyName: string }): string {
  return createMutationApprovalToken({
    surface: "dashboard",
    operation: "machines_friendly_name_set",
    transport: "dashboard:http",
    callerId: "dashboard",
    runId: "dashboard",
    machineId: input.machineId,
    resourceId: machineFriendlyNameResourceId(input.machineId),
    args: setMachineFriendlyNameMutationArgs(input),
  }, { secret: dashboardMutationSecret });
}

function friendlyNameClearApproval(input: { machineId: string }): string {
  return createMutationApprovalToken({
    surface: "dashboard",
    operation: "machines_friendly_name_clear",
    transport: "dashboard:http",
    callerId: "dashboard",
    runId: "dashboard",
    machineId: input.machineId,
    resourceId: machineFriendlyNameResourceId(input.machineId),
    args: clearMachineFriendlyNameMutationArgs(input),
  }, { secret: dashboardMutationSecret });
}

describe("serve", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
    delete process.env["HASNA_MACHINES_DB_PATH"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
    delete process.env["HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT"];
    delete process.env[MUTATION_APPROVAL_FLAG_ENV];
    delete process.env[MUTATION_APPROVAL_TOKEN_ENV];
    delete process.env["HASNA_EVENTS_DIR"];
  });

  test("returns default serve info", () => {
    const info = getServeInfo();
    expect(info.host).toBe("127.0.0.1");
    expect(info.port).toBe(7676);
    expect(info.routes).toContain("/api/status");
    expect(info.routes).toContain("/api/topology");
    expect(info.routes).toContain("/api/routes");
    expect(info.routes).toContain("/api/machines/friendly-name");
    expect(info.routes).toContain("/api/machines/details");
    expect(info.routes).toContain("/api/browserplan/fleet");
    expect(info.routes).toContain("/api/notes/machine-context");
    expect(info.routes).toContain("/api/notes/trash-policies");
    expect(info.routes).toContain("/api/projects/assignments");
    expect(info.routes).toContain("/api/daemon/status");
    expect(info.routes).toContain("/api/doctor");
  });

  test("renders dashboard html", () => {
    const html = renderDashboardHtml();
    expect(html).toContain("<title>Machines Dashboard</title>");
    expect(html).toContain("Machines Dashboard");
    expect(html).toContain("Doctor");
    expect(html).toContain("Self Test");
    expect(html).toContain("Apps");
    expect(html).toContain("AI CLIs");
  });

  test("serves new JSON endpoints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    process.env["HASNA_EVENTS_DIR"] = join(dir, "events");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      friendlyName: "Demo Node",
      hostname: "demo-node-01.private.example",
      sshAddress: "operator@demo-node-01.private.example",
      tailscaleName: "demo-node-01.tailnet.example",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      metadata: {
        machine_type: "server",
        role: "primary",
        capabilities: ["notes", "sync"],
        notesTrash: {
          enabled: true,
          retentionDays: 14,
          deleteAfterDays: 45,
          trashPath: "/home/operator/notes/.trash",
        },
      },
      apps: [{ name: "shell", manager: "custom", packageName: "sh" }],
    });
    upsertHeartbeat("demo-node-01", 42, "online", {
      agentMode: "daemon",
      tailscale: { selfDnsName: "demo-node-01.tailnet.example", selfTailscaleIps: ["100.64.0.7"] },
      storageSyncLastError: "postgres://user:pass@10.0.0.5:5432/machines failed",
      doctorSummary: {
        summary: { ok: 1, warn: 1, fail: 0 },
        blockers: [{ detail: "operator@demo-node-01.private.example 100.64.0.7" }],
      },
      privateMetadata: true,
    });
    process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
    addNotificationChannel({
      id: "local",
      type: "command",
      target: "printf ok",
      events: ["manual.test"],
      enabled: true,
    });
    delete process.env[MUTATION_APPROVAL_FLAG_ENV];
    await new EventsClient().addChannel({
      id: "events-local",
      enabled: true,
      transport: "command",
      command: { command: "printf", args: ["ok"] },
      filters: [{ source: "machines" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const server = startDashboardServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;

    const doctor = await fetch(`${base}/api/doctor`).then((response) => response.json());
    const topology = await fetch(`${base}/api/topology?tailscale=false`).then((response) => response.json());
    const deniedPrivateTopology = await fetch(`${base}/api/topology?tailscale=false&privateMetadata=true`).then((response) => response.json());
    const deniedPrivateDaemon = await fetch(`${base}/api/daemon/status?privateMetadata=true`).then((response) => response.json());
    process.env["HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT"] = "1";
    const privateTopology = await fetch(`${base}/api/topology?tailscale=false&privateMetadata=true`).then((response) => response.json());
    const routes = await fetch(`${base}/api/routes?tailscale=false`).then((response) => response.json());
    const machineDetails = await fetch(`${base}/api/machines/details?machine=demo-node-01&tailscale=false`).then((response) => response.json());
    const browserPlanFleet = await fetch(`${base}/api/browserplan/fleet?machine=machine001,spark01&tailscale=false`).then((response) => response.json());
    const noteContext = await fetch(`${base}/api/notes/machine-context?origin_machine_id=demo-node-01&source_machine_id=demo-node-01&actor_type=agent&agent_name=Notes%20Agent&source=agent`).then((response) => response.json());
    const noteTrash = await fetch(`${base}/api/notes/trash-policies?machine=demo-node-01`).then((response) => response.json());
    const daemon = await fetch(`${base}/api/daemon/status`).then((response) => response.json());
    const selfTest = await fetch(`${base}/api/self-test`).then((response) => response.json());
    const apps = await fetch(`${base}/api/apps/status`).then((response) => response.json());
    const projectAssignments = await fetch(`${base}/api/projects/assignments`).then((response) => response.json());
    const webhooks = await fetch(`${base}/api/webhooks`).then((response) => response.json());
    const emitted = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "machines.test",
        data: { ok: true },
        approval_token: eventEmitApproval(dir, "machines.test", { data: { ok: true } }),
      }),
    }).then((response) => response.json());
    const listedEvents = await fetch(`${base}/api/events`).then((response) => response.json());
    const dispatch = await fetch(`${base}/api/notifications/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: "local", approval_token: notificationTestApproval("local") }),
    }).then((response) => response.json());

    server.stop(true);

    expect(Array.isArray(doctor.checks)).toBe(true);
    expect(Array.isArray(topology.machines)).toBe(true);
    expect(Array.isArray(routes.routes)).toBe(true);
    expect(machineDetails).toMatchObject({
      machine_id: "demo-node-01",
      friendly_name: "Demo Node",
      display_name: "Demo Node",
      machine_type: "server",
      role: "primary",
      machine_capabilities: ["notes", "sync"],
      status: {
        state: "online",
        label: "Online",
        online: true,
      },
    });
    expect(browserPlanFleet).toMatchObject({
      kind: "browserplan_fleet",
      target: {
        name: "browserplan-machine001-machine011",
        install_target_excludes: ["spark01", "spark02"],
      },
      coverage: {
        expected: 1,
        returned: 1,
        known: 0,
        missing: ["machine001"],
        excluded_requested: ["spark01"],
      },
    });
    expect(browserPlanFleet.machines[0]).toMatchObject({
      machine_id: "machine001",
      known: false,
      install_state: { checked: false },
    });
    expect(noteContext.origin_machine).toMatchObject({ machine_id: "demo-node-01", display_name: "Demo Node" });
    expect(noteContext.actor).toMatchObject({ actor_type: "agent", display_name: "Notes Agent" });
    expect(noteTrash.policies[0]).toMatchObject({
      machine_id: "demo-node-01",
      display_name: "Demo Node",
      enabled: true,
      retention_days: 14,
      delete_after_days: 45,
    });
    expect(Array.isArray(daemon.agents)).toBe(true);
    expect(JSON.stringify(topology)).not.toContain("demo-node-01.tailnet.example");
    expect(JSON.stringify(topology)).not.toContain("100.64.0.7");
    expect(JSON.stringify(routes)).not.toContain("operator@demo-node-01.private.example");
    expect(JSON.stringify(daemon)).not.toContain("postgres://user:pass");
    expect(JSON.stringify(daemon)).not.toContain("100.64.0.7");
    expect(deniedPrivateTopology.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(JSON.stringify(deniedPrivateTopology)).not.toContain("demo-node-01.tailnet.example");
    expect(deniedPrivateDaemon.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(JSON.stringify(privateTopology)).toContain("demo-node-01.tailnet.example");
    expect(Array.isArray(selfTest.checks)).toBe(true);
    expect(Array.isArray(apps.apps)).toBe(true);
    expect(Array.isArray(projectAssignments.assignments)).toBe(true);
    expect(webhooks[0].id).toBe("events-local");
    expect(emitted.event.type).toBe("machines.test");
    expect(Array.isArray(listedEvents)).toBe(true);
    expect(dispatch.channelId).toBe("local");
  });

  test("friendly-name API sets, reads, clears, and paginates topology", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-friendly-name-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-02";
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;
    manifestInit();
    for (let index = 0; index < 12; index += 1) {
      manifestAdd({
        id: `demo-node-${String(index).padStart(2, "0")}`,
        platform: "linux",
        workspacePath: `/workspace/${index}`,
        updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      });
    }

    const server = startDashboardServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const denied = await fetch(`${base}/api/machines/friendly-name`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machine_id: "demo-node-11", friendly_name: "Studio Linux" }),
      });
      expect(denied.status).toBe(403);

      const setInput = { machineId: "demo-node-11", friendlyName: "Studio Linux" };
      const set = await fetch(`${base}/api/machines/friendly-name`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine_id: setInput.machineId,
          friendly_name: setInput.friendlyName,
          approval_token: friendlyNameSetApproval(setInput),
        }),
      });
      expect(set.status).toBe(200);
      expect(await set.json()).toMatchObject({
        machine_id: "demo-node-11",
        friendly_name: "Studio Linux",
        display_name: "Studio Linux",
      });

      const read = await fetch(`${base}/api/machines/friendly-name?machine=demo-node-11`).then((response) => response.json());
      expect(read).toMatchObject({ display_name: "Studio Linux" });

      const topology = await fetch(`${base}/api/topology?tailscale=false&limit=1`).then((response) => response.json());
      expect(topology.pagination).toMatchObject({
        limit: 1,
        offset: 0,
        total: 12,
        count: 1,
        hasMore: true,
        nextOffset: 1,
      });
      expect(topology.machines[0]).toMatchObject({
        machine_id: "demo-node-11",
        friendly_name: "Studio Linux",
        display_name: "Studio Linux",
      });

      const zeroLimitTopology = await fetch(`${base}/api/topology?tailscale=false&limit=0`).then((response) => response.json());
      expect(zeroLimitTopology.pagination).toMatchObject({
        limit: 1,
        offset: 0,
        count: 1,
        hasMore: true,
        nextOffset: 1,
      });

      const clearInput = { machineId: "demo-node-11" };
      const cleared = await fetch(`${base}/api/machines/friendly-name?machine=demo-node-11`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${friendlyNameClearApproval(clearInput)}` },
      });
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({
        machine_id: "demo-node-11",
        friendly_name: null,
        display_name: "demo-node-11",
      });
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("project assignments API lists, assigns, and removes with scoped approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-projects-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      hostname: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });

    const server = startDashboardServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const empty = await fetch(`${base}/api/projects/assignments`).then((response) => response.json());
      expect(empty.assignments).toEqual([]);

      const input: AssignMachineProjectInput = {
        machineId: "demo-node-01",
        projectId: "machines",
        path: "/home/operator/workspace/hasna/opensource/machines",
        workspaceId: "ws_open_machines",
        repoName: "machines",
        workspaceRoot: null,
        openFilesRoot: "/home/operator/workspace/hasna/opensource/open-files",
        label: "demo-node-01",
        kind: "machine-local",
        primary: true,
        metadata: { team: "platform" },
      };

      const denied = await fetch(`${base}/api/projects/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine_id: input.machineId,
          project_id: input.projectId,
          path: input.path,
          workspace_id: input.workspaceId,
          repo_name: input.repoName,
          open_files_root: input.openFilesRoot,
          label: input.label,
          kind: input.kind,
          primary: true,
          metadata: input.metadata,
        }),
      });
      expect(denied.status).toBe(403);

      const wrongMachineToken = createMutationApprovalToken({
        surface: "dashboard",
        operation: "machines_projects_assign",
        transport: "dashboard:http",
        callerId: "dashboard",
        runId: "dashboard",
        machineId: "other-node",
        resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
        args: projectAssignmentMutationArgs(input),
      }, { secret: dashboardMutationSecret });
      const wrongMachine = await fetch(`${base}/api/projects/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine_id: input.machineId,
          project_id: input.projectId,
          path: input.path,
          workspace_id: input.workspaceId,
          repo_name: input.repoName,
          open_files_root: input.openFilesRoot,
          label: input.label,
          kind: input.kind,
          primary: true,
          metadata: input.metadata,
          approval_token: wrongMachineToken,
        }),
      });
      expect(wrongMachine.status).toBe(403);

      const assigned = await fetch(`${base}/api/projects/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine_id: input.machineId,
          project_id: input.projectId,
          path: input.path,
          workspace_id: input.workspaceId,
          repo_name: input.repoName,
          open_files_root: input.openFilesRoot,
          label: input.label,
          kind: input.kind,
          primary: true,
          metadata: input.metadata,
          approval_token: projectAssignmentApproval(input),
        }),
      });
      expect(assigned.status).toBe(200);
      expect((await assigned.json()).assignments[0]).toMatchObject({
        machine_id: "demo-node-01",
        project_id: "machines",
        projects_location_input: {
          project: "ws_open_machines",
          metadata: {
            machine_id: "demo-node-01",
            team: "platform",
          },
        },
      });

      const filtered = await fetch(`${base}/api/projects/assignments?project=machines`).then((response) => response.json());
      expect(filtered.filters).toEqual({ machine_id: null, project_id: "machines" });
      expect(filtered.assignments).toHaveLength(1);

      const removeInput = { machineId: input.machineId, projectId: input.projectId };
      const removed = await fetch(`${base}/api/projects/assignments?machine=demo-node-01&project=machines`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${projectAssignmentRemoveApproval(removeInput)}` },
      });
      expect(removed.status).toBe(200);
      expect((await removed.json()).assignments).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dashboard POST mutation routes require scoped approval tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-security-"));
    const eventProof = join(dir, "event-proof.txt");
    const notificationProof = join(dir, "notification-proof.txt");
    const webhookProof = join(dir, "webhook-proof.txt");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    process.env["HASNA_EVENTS_DIR"] = join(dir, "events");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;

    process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
    addNotificationChannel({
      id: "notify-command",
      type: "command",
      target: "/bin/sh",
      commandArgs: ["-c", `printf notify > ${JSON.stringify(notificationProof)}`],
      events: ["manual.test"],
      enabled: true,
    });
    delete process.env[MUTATION_APPROVAL_FLAG_ENV];

    await new EventsClient().addChannel({
      id: "emit-command",
      enabled: true,
      transport: "command",
      command: { command: "sh", args: ["-c", "printf event > \"$1\"", "sh", eventProof] },
      filters: [{ source: "machines", type: "machines.secure" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await new EventsClient().addChannel({
      id: "event-command",
      enabled: true,
      transport: "command",
      command: { command: "sh", args: ["-c", "printf webhook > \"$1\"", "sh", webhookProof] },
      filters: [{ source: "machines", type: "events.test" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const server = startDashboardServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const eventWithoutToken = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "blocked" }),
      });
      expect(eventWithoutToken.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
      const envFlagOnly = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "blocked" }),
      });
      delete process.env[MUTATION_APPROVAL_FLAG_ENV];
      expect(envFlagOnly.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const eventToken = eventEmitApproval(dir, "machines.secure", { message: "approved" });
      const tamperedEvent = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "tampered", approval_token: eventToken }),
      });
      expect(tamperedEvent.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const cliSurfaceToken = createMutationApprovalToken({
        surface: "cli",
        operation: "machines_events_emit",
        transport: "cli",
        callerId: "dashboard",
        runId: "dashboard",
        resourceId: eventStoreResourceId("event", dir, "machines.secure", undefined, undefined),
        args: withEventStoreScope(dir, {
          event_type: "machines.secure",
          source: "machines",
          subject: undefined,
          severity: undefined,
          message: "approved",
          data: {},
          metadata: {},
          dedupe_key: undefined,
          deliver: true,
          dedupe: true,
        }),
      }, { secret: dashboardMutationSecret });
      const wrongSurface = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "approved", approval_token: cliSurfaceToken }),
      });
      expect(wrongSurface.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const wrongStoreToken = eventEmitApproval(join(dir, "other-store-root"), "machines.secure", { message: "approved" });
      const wrongStore = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "approved", approval_token: wrongStoreToken }),
      });
      expect(wrongStore.status).toBe(403);
      expect(existsSync(eventProof)).toBe(false);

      const approvedEvent = await fetch(`${base}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.secure", message: "approved", approval_token: eventToken }),
      });
      expect(approvedEvent.status).toBe(200);
      expect((await approvedEvent.json()).event.type).toBe("machines.secure");
      expect(readFileSync(eventProof, "utf8")).toBe("event");

      const notificationWithoutToken = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true }),
      });
      expect(notificationWithoutToken.status).toBe(403);
      expect(existsSync(notificationProof)).toBe(false);

      process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
      const notificationEnvFlagOnly = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true }),
      });
      delete process.env[MUTATION_APPROVAL_FLAG_ENV];
      expect(notificationEnvFlagOnly.status).toBe(403);
      expect(existsSync(notificationProof)).toBe(false);

      const notificationPlanToken = notificationTestApproval("notify-command");
      const tamperedNotification = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true, approval_token: notificationPlanToken }),
      });
      expect(tamperedNotification.status).toBe(403);
      expect(existsSync(notificationProof)).toBe(false);

      const notificationToken = notificationTestApproval("notify-command", { apply: true, yes: true });
      const notificationApproved = await fetch(`${base}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "notify-command", apply: true, yes: true, approval_token: notificationToken }),
      });
      expect(notificationApproved.status).toBe(200);
      expect((await notificationApproved.json()).delivered).toBe(true);
      expect(readFileSync(notificationProof, "utf8")).toBe("notify");

      const webhookWithoutToken = await fetch(`${base}/api/webhooks/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "event-command", type: "events.test", message: "blocked" }),
      });
      expect(webhookWithoutToken.status).toBe(403);
      expect(existsSync(webhookProof)).toBe(false);

      const webhookToken = webhookTestApproval(dir, "event-command", { type: "events.test", message: "approved" });
      const tamperedWebhook = await fetch(`${base}/api/webhooks/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: "event-command", type: "events.test", message: "tampered", approval_token: webhookToken }),
      });
      expect(tamperedWebhook.status).toBe(403);
      expect(existsSync(webhookProof)).toBe(false);

      const webhookApproved = await fetch(`${base}/api/webhooks/test`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${webhookToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ channelId: "event-command", type: "events.test", message: "approved" }),
      });
      expect(webhookApproved.status).toBe(200);
      expect((await webhookApproved.json()).channelId).toBe("event-command");
      expect(readFileSync(webhookProof, "utf8")).toBe("webhook");
    } finally {
      delete process.env[MUTATION_APPROVAL_FLAG_ENV];
      server.stop(true);
    }
  });

  test("explicit all-interface bind does not relax dashboard mutation approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-serve-bind-"));
    process.env["HASNA_EVENTS_DIR"] = join(dir, "events");
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = dashboardMutationSecret;
    const server = startDashboardServer({ host: "0.0.0.0", port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "machines.exposed", message: "blocked" }),
      });
      expect(response.status).toBe(403);
    } finally {
      server.stop(true);
    }
  });
});
