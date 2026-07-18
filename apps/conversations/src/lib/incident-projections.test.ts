import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { closeDb, getDb } from "./db";
import { deleteMessage, editMessage, getMessageById, getUnreadBlockers, markRead, recordReadReceipt, sendMessage } from "./messages";
import { appendIncidentProjection } from "./incident-projections";
import { createChannel, renameChannel } from "./channels";
import { computeIncidentProjectionIds } from "./incident-projection-contract";
import type { IncidentProjectionRequestV1, IncidentProjectorContext, IncidentStatus } from "../types";

const savedDbPath = process.env.CONVERSATIONS_DB_PATH;
const savedHasnaDbPath = process.env.HASNA_CONVERSATIONS_DB_PATH;
const savedTenantId = process.env.HASNA_CONVERSATIONS_TENANT_ID;
const savedAuthorityId = process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID;
let dbPath = "";
const context: IncidentProjectorContext = { tenant_id: "tenant-a", authority_id: "todos.hasna.xyz:v1" };
const incidentId = "11111111-1111-4111-8111-111111111111";

function fixture(
  version = 1,
  options: { id?: string; status?: IncidentStatus; blocked?: string[]; supersedes?: string | null; supersededBy?: string | null } = {},
): IncidentProjectionRequestV1 {
  const id = options.id ?? incidentId;
  const ids = computeIncidentProjectionIds(context.authority_id, id, version);
  const status = options.status ?? "investigating";
  return {
    schema_version: 1,
    source: "todos",
    authority_id: context.authority_id,
    incident_id: id,
    transition_id: ids.transition_id,
    incident_version: version,
    occurred_at: `2026-07-18T20:${String(version).padStart(2, "0")}:00Z`,
    event_id: ids.event_id,
    projection_key: ids.projection_key,
    incident: {
      id,
      title: "Projection incident",
      severity: "high",
      status,
      owner: "Friday",
      affected_scopes: ["service:conversations"],
      blocked_scopes: options.blocked ?? (status === "resolved" || status === "superseded" ? [] : ["agent:friday"]),
      containment: null,
      next_action: status === "resolved" || status === "superseded" ? null : "Repair projection",
      deadline: null,
      closure_evidence: status === "resolved" ? ["regression green"] : [],
      supersedes_id: options.supersedes ?? null,
      superseded_by_id: options.supersededBy ?? null,
      resolved_at: status === "resolved" || status === "superseded" ? `2026-07-18T20:${String(version).padStart(2, "0")}:00Z` : null,
      version,
      created_at: "2026-07-18T20:01:00Z",
      updated_at: `2026-07-18T20:${String(version).padStart(2, "0")}:00Z`,
    },
  };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `conversations-incident-projection-${Date.now()}-${Math.random()}.db`);
  delete process.env.HASNA_CONVERSATIONS_DB_PATH;
  process.env.CONVERSATIONS_DB_PATH = dbPath;
  process.env.HASNA_CONVERSATIONS_TENANT_ID = context.tenant_id;
  process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID = context.authority_id;
  closeDb();
});

afterEach(() => {
  closeDb();
  if (savedDbPath === undefined) delete process.env.CONVERSATIONS_DB_PATH;
  else process.env.CONVERSATIONS_DB_PATH = savedDbPath;
  if (savedHasnaDbPath === undefined) delete process.env.HASNA_CONVERSATIONS_DB_PATH;
  else process.env.HASNA_CONVERSATIONS_DB_PATH = savedHasnaDbPath;
  if (savedTenantId === undefined) delete process.env.HASNA_CONVERSATIONS_TENANT_ID;
  else process.env.HASNA_CONVERSATIONS_TENANT_ID = savedTenantId;
  if (savedAuthorityId === undefined) delete process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID;
  else process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID = savedAuthorityId;
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(dbPath + suffix); } catch {}
  }
});

describe("append-only incident projections", () => {
  test("identical replay returns the exact existing projection and message", () => {
    const first = appendIncidentProjection(fixture(), context);
    const replay = appendIncidentProjection(fixture(), context);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(first.id);
    expect(replay.message.id).toBe(first.message.id);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 1 });
  });

  test("same event with a different payload conflicts without an orphan message", () => {
    appendIncidentProjection(fixture(), context);
    const changed = fixture();
    changed.incident.title = "tampered source snapshot";
    expect(() => appendIncidentProjection(changed, context)).toThrow("different canonical payload");
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 1 });
  });

  test("requires N-1 and keeps every transition attached to the immutable root", () => {
    expect(() => appendIncidentProjection(fixture(2), context)).toThrow("predecessor version 1");
    const root = appendIncidentProjection(fixture(1), context);
    const second = appendIncidentProjection(fixture(2), context);
    const third = appendIncidentProjection(fixture(3), context);
    expect(root.message.reply_to).toBeNull();
    expect(second.message.reply_to).toBe(root.message.id);
    expect(third.message.reply_to).toBe(root.message.id);
    expect(second.supersedes_transition_id).toBe(root.transition_id);
  });

  test("later versions inherit the immutable v1 thread when routing config changes", () => {
    const originalContext: IncidentProjectorContext = {
      ...context,
      routing: { channel: "incidents", project_id: "11111111-1111-4111-8111-111111111111" },
    };
    const changedContext: IncidentProjectorContext = {
      ...context,
      routing: { channel: "incident-archive", project_id: "22222222-2222-4222-8222-222222222222" },
    };
    const root = appendIncidentProjection(fixture(1), originalContext);
    const update = appendIncidentProjection(fixture(2), changedContext);
    expect(update.message.reply_to).toBe(root.message.id);
    expect(update.message.channel).toBe("incidents");
    expect(update.message.project_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(update.message.session_id).toBe(root.message.session_id);
  });

  test("expands every frozen recipient scope and lets offline recipients become visible later", () => {
    const db = getDb();
    const invalid = fixture(1, { id: "22222222-2222-4222-8222-222222222222", blocked: ["agent-coordination"] });
    expect(() => appendIncidentProjection(invalid, context)).toThrow("frozen recipient grammar");

    const emptyChannel = fixture(1, { id: "33333333-3333-4333-8333-333333333333", blocked: ["channel:incidents"] });
    const byChannel = appendIncidentProjection(emptyChannel, context);
    expect(getUnreadBlockers("channel-agent")).toEqual([]);

    db.prepare("INSERT INTO channels (name, created_by) VALUES (?, ?)").run("incidents", "test");
    db.prepare("INSERT INTO channel_members (channel, agent) VALUES (?, ?)").run("incidents", "channel-agent");
    expect(getUnreadBlockers("channel-agent").map((message) => message.id)).toEqual([byChannel.message.id]);

    const projectId = "wks_ZXg7liK4CFJ1KZjC_Fg_b";
    const legacyProjectId = "platform-hirefast";
    const emptyProject = fixture(1, {
      id: "55555555-5555-4555-8555-555555555555",
      blocked: [`project:${projectId}`, `project:${legacyProjectId}`],
    });
    const byProject = appendIncidentProjection(emptyProject, context);
    expect(getUnreadBlockers("project-agent")).toEqual([]);
    db.prepare(
      "INSERT INTO agent_presence (id, agent, project_id, status) VALUES (?, ?, ?, ?)",
    ).run("presence-1", "project-agent", projectId, "online");
    expect(getUnreadBlockers("project-agent").map((message) => message.id)).toEqual([byProject.message.id]);
    db.prepare(
      "INSERT INTO agent_presence (id, agent, project_id, status) VALUES (?, ?, ?, ?)",
    ).run("presence-2", "legacy-project-agent", legacyProjectId, "online");
    expect(getUnreadBlockers("legacy-project-agent").map((message) => message.id)).toEqual([byProject.message.id]);
    db.prepare(
      "INSERT INTO agent_presence (id, agent, project_id, status) VALUES (?, ?, ?, ?)",
    ).run("presence-3", "wrong-case-agent", projectId.toLowerCase(), "online");
    expect(getUnreadBlockers("wrong-case-agent")).toEqual([]);

    const direct = appendIncidentProjection(fixture(1, {
      id: "66666666-6666-4666-8666-666666666666",
      blocked: ["agent:direct-agent"],
    }), context);
    expect(getUnreadBlockers("direct-agent").map((message) => message.id)).toEqual([direct.message.id]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_presence WHERE agent = ?").get("direct-agent")).toEqual({ n: 0 });
  });

  test("keeps canonical channel blockers visible across reserved rename aliases and stale projector routing", () => {
    const routedContext: IncidentProjectorContext = {
      ...context,
      routing: { channel: "incidents", project_id: "engineering" },
    };
    createChannel("incidents", "channel-reader");
    const projection = appendIncidentProjection(fixture(1, {
      id: "77777777-7777-4777-8777-777777777777",
      blocked: ["channel:incidents"],
    }), routedContext);
    const db = getDb();
    const canonicalScope = db.prepare(
      "SELECT scope FROM incident_projection_scopes WHERE projection_id = ? ORDER BY scope",
    ).all(projection.id);
    expect(getUnreadBlockers("channel-reader").map((message) => message.id)).toEqual([projection.message.id]);
    expect(getUnreadBlockers("outsider")).toEqual([]);

    renameChannel("incidents", "incident-log");
    expect(getUnreadBlockers("channel-reader").map((message) => message.id)).toEqual([projection.message.id]);
    renameChannel("incident-log", "incident-archive");
    expect(getUnreadBlockers("channel-reader").map((message) => message.id)).toEqual([projection.message.id]);
    expect(getUnreadBlockers("outsider")).toEqual([]);
    expect(db.prepare(
      "SELECT old_channel, current_channel FROM channel_rename_aliases ORDER BY old_channel",
    ).all()).toEqual([
      { old_channel: "incident-log", current_channel: "incident-archive" },
      { old_channel: "incidents", current_channel: "incident-archive" },
    ]);
    expect(db.prepare(
      "SELECT scope FROM incident_projection_scopes WHERE projection_id = ? ORDER BY scope",
    ).all(projection.id)).toEqual(canonicalScope);

    expect(markRead([projection.message.id], "channel-reader")).toBe(1);
    expect(markRead([projection.message.id], "channel-reader")).toBe(0);
    expect(markRead([projection.message.id], "outsider")).toBe(0);

    const future = appendIncidentProjection(fixture(1, {
      id: "88888888-8888-4888-8888-888888888888",
      blocked: ["channel:incidents"],
    }), routedContext);
    expect(future.message.channel).toBe("incident-archive");
    expect(future.message.session_id).toBe("channel:incident-archive");
    expect(future.message.to_agent).toBe("incident-archive");
    expect(getUnreadBlockers("channel-reader").map((message) => message.id)).toEqual([future.message.id]);
    expect(getUnreadBlockers("outsider")).toEqual([]);

    expect(() => createChannel("incidents", "attacker")).toThrow("reserved historical alias");
    createChannel("unrelated", "attacker");
    expect(() => renameChannel("unrelated", "incidents")).toThrow("reserved historical alias");
    expect(db.prepare(
      "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = 'incidents'",
    ).get()).toEqual({ current_channel: "incident-archive" });

    renameChannel("incident-archive", "incidents");
    expect(getUnreadBlockers("channel-reader").map((message) => message.id)).toEqual([future.message.id]);
    expect(db.prepare(
      "SELECT old_channel, current_channel FROM channel_rename_aliases ORDER BY old_channel",
    ).all()).toEqual([
      { old_channel: "incident-archive", current_channel: "incidents" },
      { old_channel: "incident-log", current_channel: "incidents" },
    ]);
  });

  test("missing reciprocal supersession source rolls back message, ledger, and scopes together", () => {
    const replacementId = "22222222-2222-4222-8222-222222222222";
    const missingId = "33333333-3333-4333-8333-333333333333";
    expect(() => appendIncidentProjection(fixture(1, { id: replacementId, supersedes: missingId }), context)).toThrow(
      "outside this tenant/authority",
    );
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM incident_projections").get()).toEqual({ n: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM incident_projection_scopes").get()).toEqual({ n: 0 });
  });

  test("accepts old-first forward supersession and requires reciprocal replacement", () => {
    const oldId = "22222222-2222-4222-8222-222222222222";
    const replacementId = "33333333-3333-4333-8333-333333333333";
    appendIncidentProjection(fixture(1, { id: oldId, blocked: ["agent:friday"] }), context);
    const old = appendIncidentProjection(fixture(2, {
      id: oldId,
      status: "superseded",
      blocked: ["agent:friday"],
      supersededBy: replacementId,
    }), context);
    expect(old.superseded_by_incident_id).toBe(replacementId);
    expect(old.blocking).toBe(false);
    expect(old.message.content).toContain("Blocked scopes pending transfer: 1");
    expect(old.message.content).toContain(`Replacement incident: ${replacementId}`);
    expect(getUnreadBlockers("friday").map((message) => message.id)).toEqual([old.message.id]);
    recordReadReceipt(old.message.id, "friday");
    expect(getUnreadBlockers("friday").map((message) => message.id)).toEqual([old.message.id]);

    const mismatchId = "44444444-4444-4444-8444-444444444444";
    expect(() => appendIncidentProjection(fixture(1, { id: mismatchId, supersedes: oldId }), context)).toThrow(
      "must reciprocate",
    );

    const replacement = appendIncidentProjection(fixture(1, { id: replacementId, supersedes: oldId }), context);
    expect(replacement.supersedes_incident_id).toBe(oldId);
    expect(getUnreadBlockers("friday").map((message) => message.id)).toEqual([replacement.message.id]);
    expect(appendIncidentProjection(fixture(1, { id: replacementId, supersedes: oldId }), context).replayed).toBe(true);
  });

  test("isolates tenants and validates the server-bound authority", () => {
    const first = appendIncidentProjection(fixture(), context);
    const second = appendIncidentProjection(fixture(), { ...context, tenant_id: "tenant-b" });
    expect(second.id).not.toBe(first.id);
    expect(second.message.id).not.toBe(first.message.id);
    expect(() => appendIncidentProjection(fixture(), { ...context, authority_id: "attacker:v1" })).toThrow(
      "selected Conversations authority",
    );
  });

  test("projected display and scope history reject mutation while receipts remain separate", () => {
    createChannel("incidents", "test");
    const projection = appendIncidentProjection(fixture(), context);
    expect(() => editMessage(projection.message.id, "todos-projector", "rewrite history")).toThrow("append-only");
    expect(() => deleteMessage(projection.message.id, "todos-projector")).toThrow("append-only");
    const db = getDb();
    expect(() => db.prepare("UPDATE messages SET channel = 'other' WHERE id = ?").run(projection.message.id)).toThrow("append-only");
    renameChannel("incidents", "incident-log");
    const renamed = getMessageById(projection.message.id)!;
    expect(renamed.channel).toBe("incident-log");
    expect(renamed.session_id).toBe("channel:incident-log");
    expect(renamed.to_agent).toBe("incident-log");
    expect(renamed.content).toBe(projection.message.content);
    expect(renamed.project_id).toBe(projection.message.project_id);
    expect(renamed.reply_to).toBe(projection.message.reply_to);
    expect(() => db.prepare("UPDATE messages SET project_id = 'other' WHERE id = ?").run(projection.message.id)).toThrow("append-only");
    expect(() => db.prepare("UPDATE incident_projection_scopes SET scope = 'agent:other'").run()).toThrow("append-only");
    expect(() => db.prepare("DELETE FROM incident_projection_scopes").run()).toThrow("append-only");
    db.prepare("INSERT INTO message_read_receipts (message_id, agent) VALUES (?, ?)").run(projection.message.id, "friday");
    expect(db.prepare("SELECT agent FROM message_read_receipts WHERE message_id = ?").get(projection.message.id)).toEqual({ agent: "friday" });
  });

  test("selects latest incident state before filtering blockers and keeps receipts per agent", () => {
    const active = fixture(1);
    active.incident.blocked_scopes = ["agent:friday", "agent:saturday"];
    const first = appendIncidentProjection(active, context);
    expect(getUnreadBlockers("friday").map((message) => message.id)).toEqual([first.message.id]);
    expect(getUnreadBlockers("saturday").map((message) => message.id)).toEqual([first.message.id]);

    recordReadReceipt(first.message.id, "friday");
    expect(getUnreadBlockers("friday")).toEqual([]);
    expect(getUnreadBlockers("saturday").map((message) => message.id)).toEqual([first.message.id]);

    const resolved = appendIncidentProjection(fixture(2, { status: "resolved", blocked: [] }), context);
    expect(resolved.message.content).toContain("Blocked scopes: 0");
    expect(getUnreadBlockers("friday")).toEqual([]);
    expect(getUnreadBlockers("saturday")).toEqual([]);
  });

  test("CLI mark-read semantics acknowledge a projection per agent without global mutation", () => {
    const event = fixture(1);
    event.incident.blocked_scopes = ["agent:friday", "agent:saturday"];
    const projection = appendIncidentProjection(event, context);
    expect(markRead([projection.message.id], "friday")).toBe(1);
    expect(markRead([projection.message.id], "friday")).toBe(0);
    expect(markRead([projection.message.id], "outsider")).toBe(0);
    expect(getUnreadBlockers("friday")).toEqual([]);
    expect(getUnreadBlockers("saturday").map((message) => message.id)).toEqual([projection.message.id]);
    expect(getDb().prepare("SELECT read_at FROM messages WHERE id = ?").get(projection.message.id)).toEqual({ read_at: null });
    expect(getDb().prepare(
      "SELECT agent FROM message_read_receipts WHERE message_id = ? AND agent = ?",
    ).get(projection.message.id, "friday")).toEqual({ agent: "friday" });
  });

  test("local blocker reads bind tenant and authority from the selected deployment", () => {
    const projection = appendIncidentProjection(fixture(), context);
    expect(getUnreadBlockers("friday").map((message) => message.id)).toEqual([projection.message.id]);
    delete process.env.HASNA_CONVERSATIONS_TENANT_ID;
    delete process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID;
    expect(() => getUnreadBlockers("friday")).toThrow("Canonical blocker reads require");
    process.env.HASNA_CONVERSATIONS_TENANT_ID = "tenant-b";
    process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID = context.authority_id;
    expect(() => getUnreadBlockers("friday")).toThrow("does not match stored canonical projections");
    process.env.HASNA_CONVERSATIONS_TENANT_ID = context.tenant_id;
    process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID = "engineering";
    expect(() => getUnreadBlockers("friday")).toThrow("does not match stored canonical projections");
  });

  test("keeps legacy blocker reads working without projector config when no canonical rows exist", () => {
    delete process.env.HASNA_CONVERSATIONS_TENANT_ID;
    delete process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID;
    const legacy = sendMessage({ from: "alice", to: "bob", content: "legacy blocker", blocking: true });
    expect(getUnreadBlockers("bob").map((message) => message.id)).toEqual([legacy.id]);
  });

  test("generic ingress cannot spoof projection metadata and replies remain durably scoped", () => {
    expect(() => sendMessage({
      from: "attacker",
      to: "incidents",
      content: "spoof",
      metadata: { canonical_incident_projection: { event_id: "iev_fake" } },
    })).toThrow("reserved for the dedicated projector");

    const root = sendMessage({
      from: "alice",
      to: "incidents",
      channel: "incidents",
      project_id: "engineering",
      content: "root",
    });
    const reply = sendMessage({
      from: "bob",
      to: "incidents",
      channel: "incidents",
      project_id: "engineering",
      content: "reply",
      reply_to: root.id,
    });
    expect(reply.reply_to).toBe(root.id);
    expect(() => sendMessage({
      from: "bob",
      to: "other",
      channel: "other",
      project_id: "engineering",
      content: "cross-scope",
      reply_to: root.id,
    })).toThrow("outside the message scope");
    expect(() => getDb().prepare("UPDATE messages SET project_id = 'other' WHERE id = ?").run(root.id)).toThrow(
      "reply parent scope is immutable",
    );
    expect(() => getDb().prepare("DELETE FROM messages WHERE id = ?").run(root.id)).toThrow();
  });
});
