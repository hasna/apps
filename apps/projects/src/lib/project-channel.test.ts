import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, getWorkspace, listWorkspaceEvents } from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import type { Workspace, WorkspaceKind } from "../types/workspace.js";
import { WORKSPACE_KINDS } from "../types/workspace.js";
import {
  deriveProjectChannel,
  ensureProjectChannel,
  ensureProjectChannelViaStore,
  notifyProjectAgentOnline,
  normalizeProjectChannelName,
  projectChannelSummary,
  resolveProjectChannel,
  resolveProjectChannelClass,
  resolveProjectChannelClassDetailed,
  resolveProjectChannelForProject,
  shouldEnsureProjectChannel,
  shouldNotifyProjectAgentOnline,
  type ConversationsChannelRunner,
  type ConversationsRunResult,
  type ProjectChannelStore,
} from "./project-channel.js";
import { executeWorkspaceCreation } from "./workspace-plan.js";
import { startProject } from "./project-start.js";
import { HOSTED_API_ENV_KEYS } from "../testing/spawn-env.js";
import { PROJECTS_LOCAL_REGISTRY_ENV } from "../store/project-store.js";

// Isolate the shared @hasna/contracts seam's disk tier, mirroring testSpawnEnv():
// when the environment is silent the seam reads fleet app-config files on disk
// (e.g. ~/.hasna/cloud/projects.env) and selects the hosted transport, routing
// these in-process local-store tests at the real hosted registry. An explicitly
// DEFINED-but-blank URL is the seam's own "select the local store" escape hatch
// and beats any disk pointer.
for (const key of HOSTED_API_ENV_KEYS) {
  process.env[key] = "";
}
// Store resolution fails closed with the hosted selectors blanked (owner ruling
// 2026-09-04, no silent local fallback); these in-process local-store tests
// explicitly opt in to the on-box SQLite registry.
process.env[PROJECTS_LOCAL_REGISTRY_ENV] = "1";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function recordingRunner(
  respond: (args: string[]) => ConversationsRunResult,
): { calls: string[][]; runner: ConversationsChannelRunner } {
  const calls: string[][] = [];
  return {
    calls,
    runner: (args) => {
      calls.push(args);
      return respond(args);
    },
  };
}

const ok: ConversationsRunResult = { ok: true, stdout: "{}", stderr: "" };

describe("project channel derivation", () => {
  // The channel name is the slug, verbatim. The convention lives in the slug,
  // not in this package: every one of these would previously have been
  // rewritten by a prefix table owned by the CLI.
  const cases: Array<{ slug: string; kind: WorkspaceKind; channel: string }> = [
    { slug: "projects", kind: "open-source", channel: "projects" },
    { slug: "conversations", kind: "open-source", channel: "conversations" },
    { slug: "platform-alumia", kind: "platform", channel: "platform-alumia" },
    { slug: "alumia", kind: "platform", channel: "alumia" },
    { slug: "iapp-dispatch", kind: "internal-app", channel: "iapp-dispatch" },
    { slug: "dispatch", kind: "internal-app", channel: "dispatch" },
    { slug: "cweb-hasna-site", kind: "company-website", channel: "cweb-hasna-site" },
    { slug: "community-meetups", kind: "community", channel: "community-meetups" },
    { slug: "research-vector-lab", kind: "experiment", channel: "research-vector-lab" },
    { slug: "iproj-agent-ceo", kind: "project", channel: "iproj-agent-ceo" },
    { slug: "iproj-pr-to-zero", kind: "project", channel: "iproj-pr-to-zero" },
    { slug: "handbook", kind: "docs", channel: "handbook" },
    { slug: "misc", kind: "generic", channel: "misc" },
    { slug: "oss-cloud-runtime", kind: "project", channel: "oss-cloud-runtime" },
    { slug: "loops-comms", kind: "project", channel: "loops-comms" },
  ];

  for (const item of cases) {
    test(`derives ${item.kind}/${item.slug} -> #${item.channel}`, () => {
      const derived = deriveProjectChannel({ slug: item.slug, kind: item.kind });
      expect(derived.channel).toBe(item.channel);
      expect(derived.source).toBe("derived");
    });
  }

  // Regression: `iproj-agent-ceo` (kind `project`) derived
  // `internal-iproj-agent-ceo` — double-prefixed, and contradicting the
  // channel convention, because the kind rule table pinned `project` to an
  // `internal-` prefix and the "already prefixed" guard had no `iproj-` row.
  test("a work-project slug is never re-prefixed and classifies as work-project", () => {
    const derived = deriveProjectChannel({ slug: "iproj-agent-ceo", kind: "project" });
    expect(derived.channel).toBe("iproj-agent-ceo");
    expect(derived.channel_class).toBe("work-project");
  });

  test("derivation never IMPOSES an `internal-` prefix, for any kind", () => {
    for (const kind of WORKSPACE_KINDS) {
      for (const slug of ["iproj-agent-ceo", "fleet-comms", "handbook", "misc", "projects"]) {
        const derived = deriveProjectChannel({ slug, kind });
        expect(derived.channel.startsWith("internal-")).toBe(false);
        expect(derived.channel).toBe(slug);
      }
    }
  });

  test("an `internal-` slug still passes through — the CLI imposes, it does not sanitize", () => {
    // Honest scope: the registry really does contain `internal-agent-runtime`
    // (kind `project`, unlinked). Derivation hands the slug back unchanged, so
    // an `internal-` channel name can still exist — it just is not this
    // package's invention any more. Removing it is a project-rename decision,
    // not a derivation one.
    const derived = deriveProjectChannel({ slug: "internal-agent-runtime", kind: "project" });
    expect(derived.channel).toBe("internal-agent-runtime");
    expect(derived.source).toBe("derived");
  });

  test("derivation adds no prefix of its own for any kind", () => {
    for (const kind of WORKSPACE_KINDS) {
      expect(deriveProjectChannel({ slug: "plain-name", kind }).channel).toBe("plain-name");
    }
  });

  test("linked integration wins over derivation and is normalized", () => {
    const derived = deriveProjectChannel({
      slug: "projects",
      kind: "open-source",
      integrations: { conversations_channel: "  Custom_Channel " },
    });
    expect(derived.channel).toBe("custom-channel");
    expect(derived.source).toBe("integration");
  });

  test("a legacy internal-* link keeps resolving — the migration compat path", () => {
    // The ~23 linked `internal-iproj-*` channels that predate this change must
    // keep resolving to the channel that actually holds their history.
    const derived = deriveProjectChannel({
      slug: "iproj-agent-ceo",
      kind: "project",
      integrations: { conversations_channel: "internal-iproj-agent-ceo" },
    });
    expect(derived.channel).toBe("internal-iproj-agent-ceo");
    expect(derived.source).toBe("integration");
  });

  test("throws when the slug cannot produce a channel name", () => {
    expect(() => deriveProjectChannel({ slug: "___", kind: "project" })).toThrow("valid channel name");
  });

  test("normalizeProjectChannelName cleans separators, case, and edges", () => {
    expect(normalizeProjectChannelName("  My_Channel  ")).toBe("my-channel");
    expect(normalizeProjectChannelName("UPPER.case")).toBe("upper.case");
    expect(normalizeProjectChannelName("a--b---c")).toBe("a-b-c");
    expect(normalizeProjectChannelName("-lead-trail-")).toBe("lead-trail");
  });
});

describe("resolveProjectChannelClass", () => {
  test("comes from the project kind, never from the channel name", () => {
    expect(resolveProjectChannelClass({ kind: "project" })).toBe("work-project");
    expect(resolveProjectChannelClass({ kind: "open-source" })).toBe("package");
    expect(resolveProjectChannelClass({ kind: "platform" })).toBe("product");
    expect(resolveProjectChannelClass({ kind: "internal-app" })).toBe("product");
    // `experiment` is intentionally null: see WORKSPACE_KIND_CHANNEL_CLASSES.
    expect(resolveProjectChannelClass({ kind: "experiment" })).toBeNull();
  });

  test("is null when the kind implies nothing, so the CLI asserts no class", () => {
    expect(resolveProjectChannelClass({ kind: "generic" })).toBeNull();
    expect(resolveProjectChannelClass({ kind: "docs" })).toBeNull();
    expect(resolveProjectChannelClass({ kind: "scaffold" })).toBeNull();
    expect(resolveProjectChannelClass({ kind: "remote-only" })).toBeNull();
  });

  test("an explicit class integration overrides the kind", () => {
    expect(resolveProjectChannelClass({
      kind: "generic",
      integrations: { conversations_channel_class: "Loop-Lane" },
    })).toBe("loop-lane");
    expect(resolveProjectChannelClass({
      kind: "project",
      integrations: { conversations_channel_class: "package" },
    })).toBe("package");
  });

  test("an unknown explicit class falls back to the kind rather than being forwarded", () => {
    expect(resolveProjectChannelClass({
      kind: "project",
      integrations: { conversations_channel_class: "not-a-class" },
    })).toBe("work-project");
  });

  test("an unknown explicit class is reported, not silently swallowed", () => {
    const detailed = resolveProjectChannelClassDetailed({
      kind: "project",
      integrations: { conversations_channel_class: "produkt" },
    });
    expect(detailed.channel_class).toBe("work-project");
    expect(detailed.warning).toContain("produkt");
    expect(resolveProjectChannelClassDetailed({ kind: "project" }).warning).toBeUndefined();
  });
});

describe("projectChannelSummary", () => {
  // Regression: ensure stopped pinning the link, so display/bundle surfaces
  // that read integrations.conversations_channel directly went blank for the
  // ~96% of registry projects that have no explicit link.
  test("falls back to derivation and labels the source", () => {
    expect(projectChannelSummary({ slug: "iproj-papercuts", kind: "project" }))
      .toEqual({ channel: "iproj-papercuts", source: "derived" });
    expect(projectChannelSummary({
      slug: "iproj-papercuts",
      kind: "project",
      integrations: { conversations_channel: "internal-iproj-papercuts" },
    })).toEqual({ channel: "internal-iproj-papercuts", source: "integration" });
  });

  test("never throws — an underivable slug yields a null channel", () => {
    expect(projectChannelSummary({ slug: "___", kind: "project" }))
      .toEqual({ channel: null, source: null });
  });
});

describe("shouldEnsureProjectChannel", () => {
  test("defaults on outside tests, off under NODE_ENV=test, and honors explicit flags", () => {
    expect(shouldEnsureProjectChannel({})).toBe(true);
    expect(shouldEnsureProjectChannel({ NODE_ENV: "production" })).toBe(true);
    expect(shouldEnsureProjectChannel({ NODE_ENV: "test" })).toBe(false);
    expect(shouldEnsureProjectChannel({ NODE_ENV: "test", PROJECTS_CHANNEL_ENSURE: "1" })).toBe(true);
    expect(shouldEnsureProjectChannel({ PROJECTS_CHANNEL_ENSURE: "off" })).toBe(false);
    expect(shouldEnsureProjectChannel({ OPEN_PROJECTS_CHANNEL_ENSURE: "false" })).toBe(false);
  });
});

describe("project agent online notifications", () => {
  test("are enabled by default and honor the opt-out flag", () => {
    expect(shouldNotifyProjectAgentOnline({})).toBe(true);
    expect(shouldNotifyProjectAgentOnline({ NODE_ENV: "test" })).toBe(true);
    expect(shouldNotifyProjectAgentOnline({ PROJECTS_AGENT_ONLINE_NOTIFICATIONS: "off" })).toBe(false);
    expect(shouldNotifyProjectAgentOnline({ OPEN_PROJECTS_AGENT_ONLINE_NOTIFICATIONS: "0" })).toBe(false);
    expect(shouldNotifyProjectAgentOnline({ PROJECTS_AGENT_ONLINE_NOTIFICATIONS: "yes" })).toBe(true);
  });

  test("posts a newly started coding agent to the project channel", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Fleet Comms", slug: "fleet-comms", kind: "project" }, db);
    const { calls, runner } = recordingRunner(() => ok);

    const result = notifyProjectAgentOnline(project, {
      agentTool: "claude",
      sessionName: "fleet-comms",
      agentStarted: true,
      hasAgentCommand: true,
      runner,
    });

    expect(result.status).toBe("sent");
    expect(result.sent).toBe(true);
    expect(result.channel).toBe("fleet-comms");
    expect(calls).toEqual([[
      "channel",
      "send",
      "fleet-comms",
      "A claude agent is online for Fleet Comms (tmux session: fleet-comms).",
      "--from",
      "projects",
      "-j",
    ]]);
    db.close();
  });

  test("does not emit false online notices for reused, unmanaged, disabled, or dry-run starts", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Quiet", slug: "quiet", kind: "project" }, db);
    const { calls, runner } = recordingRunner(() => ok);

    const reused = notifyProjectAgentOnline(project, {
      agentTool: "codewith",
      sessionName: "quiet",
      agentStarted: false,
      hasAgentCommand: true,
      runner,
    });
    const unmanaged = notifyProjectAgentOnline(project, {
      agentTool: "none",
      sessionName: "quiet",
      agentStarted: true,
      hasAgentCommand: false,
      runner,
    });
    const disabled = notifyProjectAgentOnline(project, {
      agentTool: "claude",
      sessionName: "quiet",
      agentStarted: true,
      hasAgentCommand: true,
      enabled: false,
      runner,
    });
    const planned = notifyProjectAgentOnline(project, {
      agentTool: "claude",
      sessionName: "quiet",
      agentStarted: false,
      hasAgentCommand: true,
      dryRun: true,
      runner,
    });

    expect(reused.status).toBe("skipped");
    expect(unmanaged.status).toBe("skipped");
    expect(disabled.status).toBe("skipped");
    expect(disabled.enabled).toBe(false);
    expect(planned.status).toBe("planned");
    expect(calls).toHaveLength(0);
    db.close();
  });

  test("reports chat delivery failures without throwing", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Fleet Comms", slug: "fleet-comms", kind: "project" }, db);
    const { runner } = recordingRunner(() => ({ ok: false, stdout: "", stderr: "chat unavailable" }));

    const result = notifyProjectAgentOnline(project, {
      agentTool: "claude",
      sessionName: "fleet-comms",
      agentStarted: true,
      hasAgentCommand: true,
      runner,
    });

    expect(result.status).toBe("error");
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("chat unavailable");
    db.close();
  });
});

describe("project channel resolution", () => {
  test("resolveProjectChannelForProject reports linked and derived channels", () => {
    const db = makeDb();
    const derivedProject = createWorkspace({ name: "Fleet Comms", slug: "fleet-comms", kind: "project" }, db);
    const linkedProject = createWorkspace({
      name: "Projects",
      slug: "projects",
      kind: "open-source",
      integrations: { conversations_channel: "projects" },
    }, db);

    const derived = resolveProjectChannelForProject(derivedProject);
    expect(derived.channel).toBe("fleet-comms");
    expect(derived.linked).toBe(false);
    expect(derived.integration_key).toBe("conversations_channel");

    const linked = resolveProjectChannelForProject(linkedProject);
    expect(linked.channel).toBe("projects");
    expect(linked.linked).toBe(true);
    expect(linked.source).toBe("integration");
    db.close();
  });

  test("resolveProjectChannel resolves a registered target by slug", () => {
    const db = makeDb();
    createWorkspace({ name: "Alumia", slug: "alumia", kind: "platform" }, db);
    const resolution = resolveProjectChannel("alumia", { db });
    expect(resolution.channel).toBe("alumia");
    expect(resolution.channel_class).toBe("product");
    expect(resolution.project.slug).toBe("alumia");
    db.close();
  });

  test("the read path reports an unusable explicit class, not just ensure", () => {
    const db = makeDb();
    const project = createWorkspace({
      name: "Typo", slug: "typo-class", kind: "project",
      integrations: { conversations_channel_class: "produkt" },
    }, db);
    const resolution = resolveProjectChannelForProject(project);
    expect(resolution.channel_class).toBe("work-project");
    expect(resolution.warnings.join(" ")).toContain("produkt");
    db.close();
  });

  test("resolveProjectChannel throws for unknown targets", () => {
    const db = makeDb();
    expect(() => resolveProjectChannel("nope-not-here", { db })).toThrow("Project not found");
    db.close();
  });
});

describe("ensureProjectChannel", () => {
  test("creates the channel and records an event, without linking it", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Fleet Comms", slug: "fleet-comms", kind: "project" }, db);
    const { calls, runner } = recordingRunner(() => ok);

    const result = ensureProjectChannel(project, { db, runner, agentId: undefined, source: "cli", command: "test" });

    expect(result.status).toBe("created");
    expect(result.created).toBe(true);
    expect(result.channel).toBe("fleet-comms");
    expect(result.linked).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 3)).toEqual(["channel", "create", "fleet-comms"]);
    expect(calls[0]).toContain("--description");

    // Ensure creates the channel but does NOT pin the derived name.
    const stored = getWorkspace(project.id, db);
    expect(stored?.integrations.conversations_channel).toBeUndefined();
    const events = listWorkspaceEvents(project.id, db);
    expect(events.some((event) => event.event_type === "channel_ensured")).toBe(true);
    db.close();
  });

  test("treats an already-existing channel as success", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Projects", slug: "projects", kind: "open-source" }, db);
    const { calls, runner } = recordingRunner(() => ({ ok: false, stdout: "", stderr: "Channel #projects already exists." }));

    const result = ensureProjectChannel(project, { db, runner });

    expect(result.status).toBe("exists");
    expect(result.created).toBe(false);
    expect(result.channel).toBe("projects");
    expect(calls).toHaveLength(1);
    db.close();
  });

  test("reports runner failures as status error without throwing", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Fleet Comms", slug: "fleet-comms", kind: "project" }, db);
    const { runner } = recordingRunner(() => ({ ok: false, stdout: "", stderr: "connection refused" }));

    const result = ensureProjectChannel(project, { db, runner });

    expect(result.status).toBe("error");
    expect(result.message).toContain("connection refused");
    db.close();
  });

  test("reports underivable slugs as status error without throwing", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Weird", slug: "weird", kind: "project" }, db);
    const broken = { ...project, slug: "___" };
    const { calls, runner } = recordingRunner(() => ok);

    const result = ensureProjectChannel(broken, { db, runner });

    expect(result.status).toBe("error");
    expect(result.message).toContain("valid channel name");
    expect(calls).toHaveLength(0);
    db.close();
  });

  test("dry run plans without calling the conversations CLI or persisting", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Fleet Comms", slug: "fleet-comms", kind: "project" }, db);
    const { calls, runner } = recordingRunner(() => ok);

    const result = ensureProjectChannel(project, { db, runner, dryRun: true });

    expect(result.status).toBe("planned");
    expect(calls).toHaveLength(0);
    expect(getWorkspace(project.id, db)?.integrations.conversations_channel).toBeUndefined();
    db.close();
  });

  test("omits --class when the project kind implies no class", () => {
    // Better a class-less channel than a class this CLI invented: the class
    // vocabulary belongs to the convention, not to a table in this package.
    const db = makeDb();
    const project = createWorkspace({ name: "Misc", slug: "misc", kind: "generic" }, db);
    const { calls, runner } = recordingRunner(() => ok);

    const result = ensureProjectChannel(project, { db, runner });

    expect(result.channel).toBe("misc");
    expect(result.channel_class).toBeNull();
    expect(calls[0]).not.toContain("--class");
    db.close();
  });

  test("forwards the kind-implied class for a work project", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "CEO", slug: "iproj-agent-ceo", kind: "project" }, db);
    const { calls, runner } = recordingRunner(() => ok);

    const result = ensureProjectChannel(project, { db, runner });

    expect(result.channel).toBe("iproj-agent-ceo");
    const args = calls[0] ?? [];
    expect(args[args.indexOf("--class") + 1]).toBe("work-project");
    db.close();
  });

  test("passes --from to the conversations CLI when provided", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Fleet Comms", slug: "fleet-comms", kind: "project" }, db);
    const { calls, runner } = recordingRunner(() => ok);

    ensureProjectChannel(project, { db, runner, from: "build-projects" });

    expect(calls[0]).toContain("--from");
    expect(calls[0]).toContain("build-projects");
    db.close();
  });
});

describe("channel ensure on project create/start", () => {
  test("executeWorkspaceCreation derives the channel integration and ensures the channel", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-channel-create-"));
    const { calls, runner } = recordingRunner(() => ok);
    try {
      const result = await executeWorkspaceCreation({
        name: "Fleet Comms Create",
        slug: "fleet-comms-create",
        kind: "project",
        primary_path: path,
      }, { db, ensureChannel: true, channelRunner: runner });

      expect(result.success).toBe(true);
      expect(result.workspace?.integrations.conversations_channel).toBe("fleet-comms-create");
      expect(result.channel?.status).toBe("created");
      expect(result.channel?.channel).toBe("fleet-comms-create");
      expect(calls).toHaveLength(1);
    } finally {
      rmSync(path, { recursive: true, force: true });
      db.close();
    }
  });

  test("executeWorkspaceCreation stores the derived channel even when ensure is disabled", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-channel-create-off-"));
    try {
      const result = await executeWorkspaceCreation({
        name: "Quiet Create",
        slug: "quiet-create",
        kind: "open-source",
        primary_path: path,
      }, { db, ensureChannel: false });

      expect(result.success).toBe(true);
      expect(result.channel).toBeNull();
      expect(result.workspace?.integrations.conversations_channel).toBe("quiet-create");
    } finally {
      rmSync(path, { recursive: true, force: true });
      db.close();
    }
  });

  test("executeWorkspaceCreation keeps a caller-provided channel name", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-channel-create-linked-"));
    const { calls, runner } = recordingRunner(() => ok);
    try {
      const result = await executeWorkspaceCreation({
        name: "Prelinked",
        slug: "prelinked",
        kind: "project",
        primary_path: path,
        integrations: { conversations_channel: "custom-lane" },
      }, { db, ensureChannel: true, channelRunner: runner });

      expect(result.workspace?.integrations.conversations_channel).toBe("custom-lane");
      expect(result.channel?.channel).toBe("custom-lane");
      expect(result.channel?.source).toBe("integration");
      expect(calls[0]?.slice(0, 3)).toEqual(["channel", "create", "custom-lane"]);
    } finally {
      rmSync(path, { recursive: true, force: true });
      db.close();
    }
  });

  test("startProject plans the channel ensure on dry run without side effects", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-channel-start-"));
    const { calls, runner } = recordingRunner(() => ok);
    try {
      createWorkspace({ name: "Start Me", slug: "start-me", kind: "project", primary_path: path }, db);
      const result = await startProject("start-me", { dryRun: true, db, ensureChannel: true, channelRunner: runner });

      expect(result.channel?.status).toBe("planned");
      expect(result.channel?.channel).toBe("start-me");
      expect(result.online_notification.status).toBe("planned");
      expect(result.online_notification.channel).toBe("start-me");
      expect(calls).toHaveLength(0);
    } finally {
      rmSync(path, { recursive: true, force: true });
      db.close();
    }
  });

  test("startProject skips the channel ensure when disabled", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-channel-start-off-"));
    try {
      createWorkspace({ name: "Quiet Start", slug: "quiet-start", kind: "project", primary_path: path }, db);
      const result = await startProject("quiet-start", { dryRun: true, db, ensureChannel: false });
      expect(result.channel).toBeNull();
    } finally {
      rmSync(path, { recursive: true, force: true });
      db.close();
    }
  });
});

describe("ensureProjectChannelViaStore (the hosted backend)", () => {
  // Minimal in-memory ProjectChannelStore double. Each hook can be swapped to
  // model an api backend that implements only part of the surface.
  function makeStore(overrides: Partial<ProjectChannelStore> = {}): {
    store: ProjectChannelStore;
    project: Workspace;
    events: Array<Record<string, unknown>>;
  } {
    const project = {
      id: "wks_cloud000000000000001",
      slug: "cloud-demo",
      name: "Cloud Demo",
      kind: "internal-app",
      status: "active",
      integrations: {},
      tags: [],
      metadata: {},
    } as unknown as Workspace;
    const events: Array<Record<string, unknown>> = [];
    const store: ProjectChannelStore = {
      transport: "http",
      async recordEvent(_id, input) {
        events.push(input as unknown as Record<string, unknown>);
        return input;
      },
      ...overrides,
    };
    return { store, project, events };
  }

  test("a 404 from the events route does not fail an ensure whose side effects landed", async () => {
    // Regression (issue #28): the channel was created and the integration was
    // persisted, then `POST /projects/:id/events` 404'd and the raw transport
    // error escaped -> the CLI exited 1 on a fully completed ensure.
    const { store, project } = makeStore({
      recordEvent: async () => {
        throw new Error("Hasna request failed: POST /projects/wks_cloud000000000000001/events -> 404");
      },
    });
    const { calls, runner } = recordingRunner(() => ok);

    const result = await ensureProjectChannelViaStore(store, project, { runner, source: "cli" });

    expect(result.status).toBe("created");
    expect(result.created).toBe(true);
    expect(result.channel).toBe("cloud-demo");
    expect(result.linked).toBe(false);
    expect(result.message).toBeUndefined();
    expect(calls).toHaveLength(1);
    // No project-record write at all: ensure does not pin a derived name.
    expect(project.integrations["conversations_channel"]).toBeUndefined();
    // The failure is reported as a non-fatal warning with the audit event
    // marked as the only thing that did not land.
    expect(result.warnings.join(" ")).toContain("audit event was not recorded");
    expect(result.side_effects).toEqual({
      channel_created: true,
      channel_present: true,
      integration_linked: false,
      event_recorded: false,
    });
  });

  test("passes the derived channel class and topic to conversations", async () => {
    // Regression (issue #28): ensure created class-less channels because it
    // never forwarded the derived channel class.
    const { store, project } = makeStore();
    const { calls, runner } = recordingRunner(() => ok);

    const result = await ensureProjectChannelViaStore(store, project, { runner, from: "agent-demo" });

    expect(result.channel_class).toBe("product");
    const args = calls[0] ?? [];
    expect(args.slice(0, 3)).toEqual(["channel", "create", "cloud-demo"]);
    expect(args[args.indexOf("--class") + 1]).toBe("product");
    expect(args).toContain("--topic");
    expect(args[args.indexOf("--from") + 1]).toBe("agent-demo");
  });

  test("retries without class/topic when the installed conversations CLI rejects them", async () => {
    const { store, project } = makeStore();
    const { calls, runner } = recordingRunner((args) =>
      args.includes("--class") ? { ok: false, stdout: "", stderr: "error: unknown option '--class'" } : ok,
    );

    const result = await ensureProjectChannelViaStore(store, project, { runner });

    expect(result.status).toBe("created");
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain("--class");
    expect(calls[1]).not.toContain("--topic");
  });

  test("an existing channel retry is idempotent and stays successful", async () => {
    const { store, project } = makeStore({
      recordEvent: async () => {
        throw new Error("Hasna request failed: POST /projects/x/events -> 404");
      },
    });
    const { runner } = recordingRunner(() => ({ ok: false, stdout: "", stderr: "Channel already exists." }));

    const first = await ensureProjectChannelViaStore(store, project, { runner });
    const second = await ensureProjectChannelViaStore(store, first.project, { runner });

    expect(first.status).toBe("exists");
    expect(second.status).toBe("exists");
    // Idempotent, and neither run touches the project record.
    expect(project.integrations["conversations_channel"]).toBeUndefined();
    expect(second.linked).toBe(false);
  });

  test("the store surface carries no write path at all", () => {
    // Structural guard: `ProjectChannelStore` intentionally exposes only
    // recordEvent. If a future change reintroduces updateProject here, the
    // one-way repoint fixed in this change becomes reachable again.
    const { store } = makeStore();
    expect(Object.keys(store).sort()).toEqual(["recordEvent", "transport"]);
  });

  test("never writes the project record — a derived name is not pinned as a link", async () => {
    // Regression guard for the one-way repoint: if ensure wrote the derived
    // name onto the record, that write would outrank derivation forever and
    // would survive a revert of the change that produced it, silently moving a
    // project off the channel holding its history.
    const { store, project } = makeStore();
    const { runner } = recordingRunner(() => ok);

    const result = await ensureProjectChannelViaStore(store, project, { runner });

    expect(result.status).toBe("created");
    expect(result.channel).toBe("cloud-demo");
    expect(result.linked).toBe(false);
    expect(project.integrations["conversations_channel"]).toBeUndefined();
    expect(result.side_effects).toEqual({
      channel_created: true,
      channel_present: true,
      integration_linked: false,
      event_recorded: true,
    });
  });
});
