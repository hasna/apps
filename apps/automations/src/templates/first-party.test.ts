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
  FIRST_PARTY_ACTION_IDS,
  FIRST_PARTY_TEMPLATE_SLUGS,
  FIRST_PARTY_TEMPLATE_VERSION,
  installAutomationTemplate,
  previewAutomationTemplateExecution,
  type ProjectSnapshotAdapter,
  type ProjectSnapshotReadResult,
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
      const runsBeforeRejectedReplay = store.listRuns();
      const actionsBeforeRejectedReplay = store.listQueueEntries();
      await expect(actionWorker.replayPartial(source!.id, {
        actor: { id: "agent-replay-mismatch", type: "agent" },
      })).rejects.toThrow("supplied actor does not match configured authority actor");
      expect(store.listRuns()).toEqual(runsBeforeRejectedReplay);
      expect(store.listQueueEntries()).toEqual(actionsBeforeRejectedReplay);
      expect(conversationsCalls).toBe(1);

      const replayed = await actionWorker.replayPartial(source!.id);
      expect(replayed.status).toBe("succeeded");
      expect(todosCalls).toBe(1);
      expect(mementosCalls).toBe(1);
      expect(conversationsCalls).toBe(2);
      expect(replayed.run?.status).toBe("succeeded");
      expect(replayed.actions?.find((action) => action.id.endsWith(":partial-replay"))?.result?.metadata?.deliveryStatus).toBe("succeeded");
      expect(store.requireQueueEntry(source!.id).result?.metadata?.deliveryStatus).toBe("partial");
      expect(store.requireQueueEntry(`${source!.id}:partial-replay`).metadata?.replayOnlySinks).toEqual(["conversations"]);
    } finally {
      store.close();
    }
  });

  test("rejects caller actor identity mismatches before creating a run or writing", async () => {
    const store = new AutomationsStore();
    try {
      let writes = 0;
      install(store, FIRST_PARTY_TEMPLATE_SLUGS.workLifecycle, {
        todos: {},
        mementos: {},
        conversations: {},
      });
      const actionWorker = worker(store, {
        workLifecycle: {
          updateTodos: async () => {
            writes += 1;
            return {};
          },
          updateMementos: async () => {
            writes += 1;
            return {};
          },
          updateConversations: async () => {
            writes += 1;
            return {};
          },
        },
        projectSnapshot: emptySnapshotAdapter(),
        sessionBootstrap: noOpSessionAdapter(),
      });
      const reference = `${FIRST_PARTY_TEMPLATE_SLUGS.workLifecycle}@${FIRST_PARTY_TEMPLATE_VERSION}`;

      await expect(actionWorker.run(reference, {
        actor: { id: "different-agent", type: "agent" },
      })).rejects.toThrow("supplied actor does not match configured authority actor");
      await expect(actionWorker.run(reference, {
        actor: { id: actor.id, type: "service" },
      })).rejects.toThrow("supplied actor does not match configured authority actor");

      expect(writes).toBe(0);
      expect(store.listRuns()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("project-snapshot is read-only, bounded, and leaves an empty source unverified until failed-only replay", async () => {
    const store = new AutomationsStore();
    try {
      let mementos: JsonValue = [];
      const calls: Record<string, number> = {};
      const read = (source: string, value: () => JsonValue) => async (): Promise<ProjectSnapshotReadResult> => {
        calls[source] = (calls[source] ?? 0) + 1;
        return {
          authority: "cloud",
          complete: true,
          verified: true,
          value: value(),
          receipt: { source },
        };
      };
      const adapters: ProjectSnapshotAdapter = {
        authority: "cloud",
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
      expect(store.requireQueueEntry(`${first.actions![0]!.id}:partial-replay`).metadata?.replayOnlySinks).toEqual(["mementos"]);
      expect(replayed.actions?.find((action) => action.id.endsWith(":partial-replay"))?.result?.output).toMatchObject({
        snapshot: {
          projects: [{ id: "project-1" }],
          todos: [{ id: "task-1" }],
          conversations: [{ id: "message-1" }],
          mementos: [{ id: "memento-1" }],
          repository: { head: "abc123" },
        },
      });
    } finally {
      store.close();
    }
  });

  test("project-snapshot rejects non-empty but incomplete cloud source data", async () => {
    const store = new AutomationsStore();
    try {
      const valid = (value: JsonValue): ProjectSnapshotReadResult => ({
        authority: "cloud",
        complete: true,
        verified: true,
        value,
      });
      const adapters: ProjectSnapshotAdapter = {
        authority: "cloud",
        readProjects: async () => ({
          authority: "cloud",
          complete: false,
          verified: true,
          value: [{ id: "project-1" }],
        }),
        readTodos: async () => valid([{ id: "task-1" }]),
        readConversations: async () => valid([{ id: "message-1" }]),
        readMementos: async () => valid([{ id: "memento-1" }]),
        readRepository: async () => valid({ head: "abc123" }),
      };
      install(store, FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot, {
        projectId: "project-1",
      });
      const actionWorker = worker(store, {
        workLifecycle: noOpWorkAdapter(),
        projectSnapshot: adapters,
        sessionBootstrap: noOpSessionAdapter(),
      });

      const receipt = await actionWorker.run(
        `${FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot}@${FIRST_PARTY_TEMPLATE_VERSION}`,
      );
      const projects = receipt.partial?.find((entry) => entry.sink === "projects");
      expect(receipt.status).toBe("failed");
      expect(projects?.status).toBe("failed");
      expect(projects?.error?.code).toBe("SOURCE_UNVERIFIED");
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

  test("keeps one adapter idempotency identity across uncompensated replay generations", async () => {
    const store = new AutomationsStore();
    try {
      let remainingProjectFailures = 2;
      let remainingIdentityCompensationFailures = 2;
      const liveBindings = new Set<string>();
      const bindingByIdempotencyKey = new Map<string, string>();
      const identityActionIds: string[] = [];
      const events: string[] = [];
      const adapters: SessionBootstrapAdapter = {
        verifyExactScope: async () => ({ exact: true }),
        createBinding: async (binding, _input, _scope, context) => {
          events.push(`create:${binding}`);
          if (binding === "identity") identityActionIds.push(context.actionId);
          if (binding === "project" && remainingProjectFailures > 0) {
            remainingProjectFailures -= 1;
            throw new Error("project binding failed");
          }
          const key = `${context.actionId}:${binding}`;
          let bindingId = bindingByIdempotencyKey.get(key);
          if (!bindingId) {
            bindingId = `${binding}-${bindingByIdempotencyKey.size + 1}`;
            bindingByIdempotencyKey.set(key, bindingId);
            liveBindings.add(bindingId);
          }
          return { bindingId, receipt: { binding, created: true } };
        },
        compensateBinding: async (binding, bindingId) => {
          events.push(`compensate:${binding}:${bindingId}`);
          if (binding === "identity" && remainingIdentityCompensationFailures > 0) {
            remainingIdentityCompensationFailures -= 1;
            throw new Error("identity compensation failed");
          }
          liveBindings.delete(bindingId);
          for (const [key, value] of bindingByIdempotencyKey) {
            if (value === bindingId) bindingByIdempotencyKey.delete(key);
          }
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

      const first = await actionWorker.run(`${FIRST_PARTY_TEMPLATE_SLUGS.sessionBootstrap}@${FIRST_PARTY_TEMPLATE_VERSION}`);
      expect(first.status).toBe("failed");
      const firstEventCount = events.length;
      const second = await actionWorker.replayPartial(first.actions![0]!.id);
      expect(second.status).toBe("failed");
      const secondEvents = events.slice(firstEventCount);
      expect(secondEvents[0]).toBe("compensate:identity:identity-1");
      expect(secondEvents.some((event) => event === "create:identity")).toBe(false);
      const secondAction = second.actions!.find((action) => action.id.endsWith(":partial-replay"))!;
      const third = await actionWorker.replayPartial(secondAction.id);

      expect(third.status).toBe("succeeded");
      expect(identityActionIds).toHaveLength(2);
      expect(new Set(identityActionIds).size).toBe(1);
      expect([...liveBindings].filter((bindingId) => bindingId.startsWith("identity-"))).toHaveLength(1);
      expect(store.requireQueueEntry(secondAction.id).metadata?.partialReplayRootActionId).toBe(first.actions![0]!.id);
      const thirdAction = third.actions!.find((action) => action.id.endsWith(":partial-replay:partial-replay"))!;
      expect(thirdAction.metadata?.partialReplayRootActionId).toBe(first.actions![0]!.id);
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

  test("registers the declared session-bootstrap compensation action", () => {
    const definitions = createFirstPartyActionDefinitions({
      workLifecycle: noOpWorkAdapter(),
      projectSnapshot: emptySnapshotAdapter(),
      sessionBootstrap: noOpSessionAdapter(),
    });
    expect(definitions.map((definition) => definition.manifest.id)).toContain(
      FIRST_PARTY_ACTION_IDS.sessionBootstrapCompensate,
    );
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
  const read = (value: JsonValue): ProjectSnapshotReadResult => ({
    authority: "cloud",
    complete: true,
    verified: true,
    value,
  });
  return {
    authority: "cloud",
    readProjects: async () => read([{ id: "project-1" }]),
    readTodos: async () => read([{ id: "task-1" }]),
    readConversations: async () => read([{ id: "message-1" }]),
    readMementos: async () => read([{ id: "memento-1" }]),
    readRepository: async () => read({ head: "abc123" }),
  };
}
