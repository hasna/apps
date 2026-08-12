import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { JsonObject, JsonValue } from "@hasna/actions";
import {
  AutomationsStore,
  TypedActionWorker,
  createFirstPartyActionDefinitions,
  createFirstPartyTemplateRegistry,
  FIRST_PARTY_TEMPLATE_SLUGS,
  FIRST_PARTY_TEMPLATE_VERSION,
  installAutomationTemplate,
  previewAutomationTemplateExecution,
  type ProjectSnapshotAdapter,
  type SessionBootstrapAdapter,
  type WorkLifecycleAdapter,
} from "../index.js";

let dataDir = "";

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-first-party-"));
  process.env.HASNA_AUTOMATIONS_DIR = dataDir;
});

afterEach(() => {
  delete process.env.HASNA_AUTOMATIONS_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

const actor = { id: "agent-first-party-tests", type: "agent" as const };

function install(
  store: AutomationsStore,
  slug: string,
  inputs: Record<string, JsonValue>,
): void {
  const registry = createFirstPartyTemplateRegistry();
  installAutomationTemplate(registry, { slug, version: FIRST_PARTY_TEMPLATE_VERSION, inputs }, store);
}

function worker(
  store: AutomationsStore,
  adapters: {
    workLifecycle: WorkLifecycleAdapter;
    projectSnapshot: ProjectSnapshotAdapter;
    sessionBootstrap: SessionBootstrapAdapter;
  },
): TypedActionWorker {
  return new TypedActionWorker({
    store,
    definitions: createFirstPartyActionDefinitions(adapters),
    authority: {
      actor,
      permissions: [
        "todos:write",
        "mementos:write",
        "conversations:write",
        "projects:read",
        "todos:read",
        "conversations:read",
        "mementos:read",
        "repository:read",
        "identity:read",
        "identity:write",
        "projects:write",
        "monitoring:write",
        "policy:write",
      ],
    },
  });
}

function noOpSessionAdapter(): SessionBootstrapAdapter {
  return {
    verifyExactScope: async () => ({ exact: true }),
    createBinding: async (binding) => ({
      bindingId: `${binding}-binding`,
      receipt: { binding, created: true },
    }),
    compensateBinding: async (binding, bindingId) => ({
      receipt: { binding, bindingId, compensated: true },
    }),
  };
}

describe("first-party automation templates", () => {
  test("work-lifecycle records independent sink receipts and replays only the failed sink", async () => {
    const store = new AutomationsStore();
    try {
      let failConversations = true;
      let todosCalls = 0;
      let mementosCalls = 0;
      let conversationsCalls = 0;
      const adapters: WorkLifecycleAdapter = {
        updateTodos: async () => {
          todosCalls += 1;
          return { taskId: "task-1", updated: true };
        },
        updateMementos: async () => {
          mementosCalls += 1;
          return { key: "work-status", saved: true };
        },
        updateConversations: async () => {
          conversationsCalls += 1;
          if (failConversations) throw new Error("conversations unavailable");
          return { messageId: "message-1", posted: true };
        },
      };
      install(store, FIRST_PARTY_TEMPLATE_SLUGS.workLifecycle, {
        todos: { taskId: "task-1", state: "DONE" },
        mementos: { key: "work-status", summary: "done" },
        conversations: { channel: "automations", body: "done" },
      });
      const actionWorker = worker(store, {
        workLifecycle: adapters,
        projectSnapshot: emptySnapshotAdapter(),
        sessionBootstrap: noOpSessionAdapter(),
      });

      const first = await actionWorker.run(`${FIRST_PARTY_TEMPLATE_SLUGS.workLifecycle}@${FIRST_PARTY_TEMPLATE_VERSION}`);
      expect(first.status).toBe("failed");
      expect(first.partial?.map((receipt) => [receipt.sink, receipt.status])).toEqual([
        ["todos", "succeeded"],
        ["mementos", "succeeded"],
        ["conversations", "failed"],
      ]);
      expect(todosCalls).toBe(1);
      expect(mementosCalls).toBe(1);
      expect(conversationsCalls).toBe(1);

      failConversations = false;
      const source = first.actions?.[0];
      expect(source?.metadata?.replayOnlySinks).toBeUndefined();
      const replayed = await actionWorker.replayPartial(source!.id);
      expect(replayed.status).toBe("succeeded");
      expect(todosCalls).toBe(1);
      expect(mementosCalls).toBe(1);
      expect(conversationsCalls).toBe(2);
      expect(replayed.run?.status).toBe("succeeded");
      expect(replayed.actions?.find((action) => action.id.endsWith(":partial-replay"))?.result?.metadata?.deliveryStatus).toBe("succeeded");
      expect(store.requireQueuedAction(source!.id).result?.metadata?.deliveryStatus).toBe("partial");
      expect(store.requireQueuedAction(`${source!.id}:partial-replay`).metadata?.replayOnlySinks).toEqual(["conversations"]);
    } finally {
      store.close();
    }
  });

  test("project-snapshot is read-only, bounded, and leaves an empty source unverified until failed-only replay", async () => {
    const store = new AutomationsStore();
    try {
      let mementos: JsonValue = [];
      const calls: Record<string, number> = {};
      const read = (source: string, value: () => JsonValue) => async (): Promise<JsonValue> => {
        calls[source] = (calls[source] ?? 0) + 1;
        return value();
      };
      const adapters: ProjectSnapshotAdapter = {
        readProjects: read("projects", () => [{ id: "project-1" }]),
        readTodos: read("todos", () => [{ id: "task-1" }]),
        readConversations: read("conversations", () => [{ id: "message-1" }]),
        readMementos: read("mementos", () => mementos),
        readRepository: read("repository", () => ({ head: "abc123" })),
      };
      install(store, FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot, {
        projectId: "project-1",
        limit: 10,
      });
      const actionWorker = worker(store, {
        workLifecycle: noOpWorkAdapter(),
        projectSnapshot: adapters,
        sessionBootstrap: noOpSessionAdapter(),
      });

      const first = await actionWorker.run(`${FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot}@${FIRST_PARTY_TEMPLATE_VERSION}`);
      expect(first.status).toBe("failed");
      expect(first.partial?.find((receipt) => receipt.sink === "mementos")?.status).toBe("failed");
      expect(calls).toEqual({
        projects: 1,
        todos: 1,
        conversations: 1,
        mementos: 1,
        repository: 1,
      });

      mementos = [{ id: "memento-1" }];
      const replayed = await actionWorker.replayPartial(first.actions![0]!.id);
      expect(replayed.status).toBe("succeeded");
      expect(calls).toEqual({
        projects: 1,
        todos: 1,
        conversations: 1,
        mementos: 2,
        repository: 1,
      });
      expect(store.requireQueuedAction(`${first.actions![0]!.id}:partial-replay`).metadata?.replayOnlySinks).toEqual(["mementos"]);
    } finally {
      store.close();
    }
  });

  test("session-bootstrap refuses ambiguous scope without writes and records compensation for created bindings", async () => {
    const store = new AutomationsStore();
    try {
      let exact = false;
      let failProject = true;
      const created: string[] = [];
      const compensated: string[] = [];
      const adapters: SessionBootstrapAdapter = {
        verifyExactScope: async () => ({ exact, reason: "scope has two matching projects" }),
        createBinding: async (binding) => {
          if (failProject && binding === "project") throw new Error("project binding failed");
          const bindingId = `${binding}-${created.length + 1}`;
          created.push(binding);
          return { bindingId, receipt: { binding, created: true } };
        },
        compensateBinding: async (binding, bindingId) => {
          compensated.push(`${binding}:${bindingId}`);
          return { receipt: { binding, bindingId, compensated: true } };
        },
      };
      install(store, FIRST_PARTY_TEMPLATE_SLUGS.sessionBootstrap, {
        identityId: "identity-1",
        projectId: "project-1",
        identity: { name: "agent" },
        project: { slug: "automations" },
        monitoring: { channels: ["announcements"] },
        policy: { profile: "live-codewith" },
      });
      const actionWorker = worker(store, {
        workLifecycle: noOpWorkAdapter(),
        projectSnapshot: emptySnapshotAdapter(),
        sessionBootstrap: adapters,
      });

      const ambiguous = await actionWorker.run(`${FIRST_PARTY_TEMPLATE_SLUGS.sessionBootstrap}@${FIRST_PARTY_TEMPLATE_VERSION}`);
      expect(ambiguous.status).toBe("failed");
      expect(ambiguous.actions?.[0]?.status).toBe("dead");
      expect(created).toEqual([]);

      exact = true;
      const partial = await actionWorker.run(`${FIRST_PARTY_TEMPLATE_SLUGS.sessionBootstrap}@${FIRST_PARTY_TEMPLATE_VERSION}`);
      expect(partial.status).toBe("failed");
      expect(partial.partial?.every((receipt) => receipt.status === "failed")).toBe(true);
      expect(compensated.length).toBe(3);
      expect(partial.partial?.map((receipt) => receipt.sink).sort()).toEqual(["identity", "monitoring", "policy", "project"]);

      failProject = false;
      const replayed = await actionWorker.replayPartial(partial.actions![0]!.id);
      expect(replayed.status).toBe("succeeded");
      expect(created.length).toBe(7);
      expect(replayed.run?.status).toBe("succeeded");
      expect(replayed.actions?.find((action) => action.id.endsWith(":partial-replay"))?.result?.metadata?.deliveryStatus).toBe("succeeded");
    } finally {
      store.close();
    }
  });

  test("runtime preview declares all first-party effects and makes zero adapter calls", () => {
    const registry = createFirstPartyTemplateRegistry();
    for (const template of [
      FIRST_PARTY_TEMPLATE_SLUGS.workLifecycle,
      FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot,
      FIRST_PARTY_TEMPLATE_SLUGS.sessionBootstrap,
    ]) {
      const inputs: Record<string, JsonValue> = template === FIRST_PARTY_TEMPLATE_SLUGS.workLifecycle
        ? {
          todos: {},
          mementos: {},
          conversations: {},
        }
        : template === FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot
          ? { projectId: "project-1" }
          : {
            identityId: "identity-1",
            projectId: "project-1",
            identity: {},
            project: {},
            monitoring: {},
            policy: {},
          };
      const preview = previewAutomationTemplateExecution(registry, {
        slug: template,
        version: FIRST_PARTY_TEMPLATE_VERSION,
        inputs,
      });
      expect(preview.effect).toEqual({
        kind: "none",
        executorCalls: 0,
        adapterCalls: 0,
        writes: 0,
      });
      expect(preview.actionPlan[0]?.effects.length).toBeGreaterThan(0);
      expect(preview.authority.mode).toBe(template === FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot ? "read-only" : "write");
    }
  });
});

function noOpWorkAdapter(): WorkLifecycleAdapter {
  return {
    updateTodos: async () => ({ ok: true }),
    updateMementos: async () => ({ ok: true }),
    updateConversations: async () => ({ ok: true }),
  };
}

function emptySnapshotAdapter(): ProjectSnapshotAdapter {
  return {
    readProjects: async () => [{ id: "project-1" }],
    readTodos: async () => [{ id: "task-1" }],
    readConversations: async () => [{ id: "message-1" }],
    readMementos: async () => [{ id: "memento-1" }],
    readRepository: async () => ({ head: "abc123" }),
  };
}
