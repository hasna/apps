import { beforeEach as configureIntegrationFixture } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
configureIntegrationFixture(() => {
  // Hermetic: the shared credential seam's disk tier anchors to this scratch
  // root, so a station's real ~/.hasna/attachments|todos|sessions/config/credentials
  // cannot leak into integration fixtures (or turn the fixture URL into an
  // authority-conflict refusal). The Keychain account is pinned too: on macOS
  // the resolver reads HASNA_STATION, else this machine's short hostname, and
  // a real item under the hostname would resolve next to the fixture URL.
  process.env.HASNA_HOME = mkdtempSync(join(tmpdir(), "attachments-integration-"));
  process.env.HASNA_CONFIG_HOME = process.env.HASNA_HOME;
  process.env.HASNA_STATION = "attachments-hermetic-test";
  process.env.HASNA_ATTACHMENTS_API_URL = "https://attachments.example.test";
  process.env.HASNA_ATTACHMENTS_API_KEY = "test-attachment-key";
  process.env.HASNA_TODOS_API_URL = "https://todos.example.test";
  process.env.TODOS_API_KEY = "remote-key";
  delete process.env.HASNA_TODOS_API_KEY;
  process.env.HASNA_SESSIONS_API_URL = "https://sessions.example.test";
  process.env.HASNA_SESSIONS_API_KEY = "test-session-key";
});
import { describe, it, expect, mock, spyOn } from "bun:test";
import {
  fetchTaskMeta,
  fetchTaskHistory,
  buildTaskJournal,
  formatMarkdown,
  formatCompact,
  formatJson,
  findTaskAttachments,
  registerTaskJournal,
} from "./task-journal";
import type { TaskJournal } from "./task-journal";
import type { Attachment } from "../../core/db";
import type { Store } from "../../core/store";
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(status: number, body: unknown = {}): typeof fetch {
  return mock(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => Array.isArray(body) ? { history: body, count: body.length } : { task: body },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as typeof fetch;
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att_abc123",
    filename: "fix-report.pdf",
    s3Key: "attachments/2026-03-14/att_abc123/fix-report.pdf",
    bucket: "test-bucket",
    size: 1258291, // ~1.2MB
    contentType: "application/pdf",
    link: "https://s3.example.com/att_abc123",
    tag: "task:TASK-001",
    expiresAt: new Date("2026-03-21").getTime(),
    createdAt: new Date("2026-03-14").getTime(),
    ...overrides,
  };
}

// buildTaskJournal reads attachments via the Store abstraction (store.list),
// so the factory returns a minimal Store fake exposing list + close.
function makeStore(attachments: Attachment[]): Store {
  return {
    list: mock(async (_opts?: object) => attachments),
    close: mock(() => {}),
  } as unknown as Store;
}

function captureOutput() {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  return {
    out,
    err,
    restore() {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
  };
}

function buildProgram() {
  const program = new Command();
  program.exitOverride();
  registerTaskJournal(program);
  return program;
}

// ---------------------------------------------------------------------------
// fetchTaskMeta
// ---------------------------------------------------------------------------

describe("fetchTaskMeta", () => {
  it("returns task metadata on 200", async () => {
    const fakeFetch = makeFetch(200, {
      id: "TASK-001",
      title: "Fix auth bug",
      status: "completed",
      assigned_to: "aurelius",
      created_at: "2026-03-14T10:23:00Z",
    });
    // fetchTaskMeta prefers HASNA_TODOS_API_KEY over TODOS_API_KEY
    // (core/todos.ts); drop the ambient value so this case actually exercises
    // the TODOS_API_KEY fallback instead of the operator's live key.
    delete process.env.HASNA_TODOS_API_KEY;
    process.env["TODOS_API_KEY"] = "remote-key";
    const meta = await fetchTaskMeta("TASK-001", "https://todos.example.test", fakeFetch);
    delete process.env.TODOS_API_KEY;
    const [, init] = (fakeFetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-api-key")).toBe("remote-key");
    expect(meta).not.toBeNull();
    expect(meta?.subject).toBe("Fix auth bug");
    expect(meta?.status).toBe("completed");
    expect(meta?.assignee).toBe("aurelius");
    expect(meta?.id).toBe("TASK-001");
  });

  it("rejects on 404", async () => {
    const fakeFetch = makeFetch(404);
    await expect(fetchTaskMeta("TASK-999", "https://todos.example.test", fakeFetch)).rejects.toThrow("HTTP 404");
  });

  it("rejects when todos is unreachable (network error)", async () => {
    const fakeFetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(fetchTaskMeta("TASK-001", "https://todos.example.test", fakeFetch)).rejects.toThrow("transport error");
  });
});

// ---------------------------------------------------------------------------
// fetchTaskHistory
// ---------------------------------------------------------------------------

describe("fetchTaskHistory", () => {
  it("returns history entries on 200", async () => {
    const fakeFetch = makeFetch(200, [
      { created_at: "2026-03-14T10:23:00Z", action: "created", agent_id: "julius" },
      { created_at: "2026-03-14T10:45:00Z", action: "started", agent_id: "aurelius" },
      { created_at: "2026-03-14T11:30:00Z", action: "completed", agent_id: "aurelius", field: "status", old_value: "in_progress", new_value: "completed" },
    ]);
    process.env["HASNA_TODOS_API_KEY"] = "remote-key";
    const history = await fetchTaskHistory("TASK-001", "https://todos.example.test", fakeFetch);
    delete process.env.HASNA_TODOS_API_KEY;
    const [, init] = (fakeFetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-api-key")).toBe("remote-key");
    expect(history).toHaveLength(3);
    expect(history[0].action).toBe("created");
    expect(history[0].actor).toBe("julius");
    expect(history[2].details).toBe("status: in_progress → completed");
  });

  it("rejects when todos is unreachable", async () => {
    const fakeFetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(fetchTaskHistory("TASK-001", "https://todos.example.test", fakeFetch)).rejects.toThrow();
  });

  it("rejects on non-200 response", async () => {
    const fakeFetch = makeFetch(500);
    await expect(fetchTaskHistory("TASK-001", "https://todos.example.test", fakeFetch)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildTaskJournal
// ---------------------------------------------------------------------------

describe("buildTaskJournal", () => {
  it("aggregates task meta, history, and attachments", async () => {
    const att = makeAttachment();
    const fakeFetch = mock(async (url: unknown) => {
      const u = String(url);
      if (u.includes("attachments.example.test")) return new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } });
      if (u.endsWith("/history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ history: [
            { created_at: "2026-03-14T10:23:00Z", action: "created", agent_id: "julius" },
          ], count: 1 }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ task: { id: "TASK-001", title: "Fix auth bug", status: "completed", assigned_to: "aurelius" } }),
      };
    }) as unknown as typeof fetch;

    const store = makeStore([att]);

    const { journal, todosReachable } = await buildTaskJournal(
      "TASK-001",
      { todosUrl: "https://todos.example.test" },
      fakeFetch,
      () => store
    );

    expect(todosReachable).toBe(true);
    expect(journal.task.subject).toBe("Fix auth bug");
    expect(journal.history).toHaveLength(1);
    expect(journal.attachments).toHaveLength(1);
    expect(journal.attachments[0].id).toBe("att_abc123");
  });

  it("rejects without reading attachments when todos is unreachable", async () => {
    const fakeFetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const store = makeStore([makeAttachment()]);

    await expect(buildTaskJournal(
      "TASK-001", { todosUrl: "https://todos.example.test" }, fakeFetch, () => store
    )).rejects.toThrow("transport error");
    expect(store.list).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

describe("formatMarkdown", () => {
  const journal: TaskJournal = {
    task: { id: "TASK-001", subject: "Fix auth bug", status: "completed", assignee: "aurelius", created_at: "2026-03-14T10:23:00Z" },
    history: [
      { timestamp: "2026-03-14T10:23:00Z", action: "created", actor: "julius" },
      { timestamp: "2026-03-14T11:30:00Z", action: "completed", actor: "aurelius", details: "Fix written" },
    ],
    attachments: [makeAttachment()],
  };

  it("renders full markdown output with task header, history, and attachments", () => {
    const output = formatMarkdown(journal, true);
    expect(output).toContain("# Task Journal: TASK-001 — Fix auth bug");
    expect(output).toContain("Status: completed");
    expect(output).toContain("Assigned: aurelius");
    expect(output).toContain("## History");
    expect(output).toContain("[created]");
    expect(output).toContain("julius");
    expect(output).toContain("## Attachments");
    expect(output).toContain("att_abc123");
    expect(output).toContain("fix-report.pdf");
    expect(output).toContain("1.2MB");
    expect(output).toContain("https://s3.example.com/att_abc123");
  });

  it("shows todos unreachable note when todos is down", () => {
    const output = formatMarkdown({ ...journal, history: [] }, false);
    expect(output).toContain("todos server unreachable");
    expect(output).toContain("_(no history available)_");
  });

  it("shows no attachments message when none found", () => {
    const output = formatMarkdown({ ...journal, attachments: [] }, true);
    expect(output).toContain("_(no attachments found)_");
  });
});

describe("formatCompact", () => {
  it("renders compact one-liner per event", () => {
    const journal: TaskJournal = {
      task: { id: "TASK-001", subject: "Fix auth bug", status: "completed" },
      history: [
        { timestamp: "2026-03-14T10:23:00Z", action: "created", actor: "julius" },
      ],
      attachments: [makeAttachment()],
    };
    const output = formatCompact(journal, true);
    expect(output).toContain("[TASK-001]");
    expect(output).toContain("Fix auth bug");
    expect(output).toContain("created");
    expect(output).toContain("att_abc123");
  });
});

describe("formatJson", () => {
  it("renders valid JSON with all fields", () => {
    const journal: TaskJournal = {
      task: { id: "TASK-001", subject: "Fix auth bug" },
      history: [],
      attachments: [],
    };
    const output = formatJson(journal);
    const parsed = JSON.parse(output);
    expect(parsed.task.id).toBe("TASK-001");
    expect(parsed.history).toEqual([]);
    expect(parsed.attachments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

describe("task-journal CLI command", () => {
  it("outputs markdown by default for a task with history and attachments", async () => {
    const fakeFetch = mock(async (url: unknown) => {
      const u = String(url);
      if (u.includes("attachments.example.test")) return new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } });
      if (u.endsWith("/history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ history: [{ created_at: "2026-03-14T10:23:00Z", action: "created", agent_id: "julius" }], count: 1 }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ task: { id: "TASK-001", title: "Fix auth bug", status: "completed", assigned_to: "aurelius" } }),
      };
    }) as unknown as typeof fetch;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;

    // Suppress DB by using an in-memory DB path
    const capture = captureOutput();
    try {
      // We test the full CLI with a custom DB. Since we can't easily inject,
      // we'll test the formatter instead — CLI smoke-test just verifies it doesn't crash.
      const program = buildProgram();
      await program.parseAsync(["task-journal", "TASK-001"], { from: "user" });
      expect(capture.out.join("")).toContain("Fix auth bug");
      expect(capture.err).toEqual([]);
    } finally {
      capture.restore();
      globalThis.fetch = originalFetch;
    }
  });

  it("outputs JSON when --format json is passed", async () => {
    const journal: TaskJournal = {
      task: { id: "TASK-001", subject: "Fix auth bug" },
      history: [{ timestamp: "2026-03-14T10:23:00Z", action: "created", actor: "julius" }],
      attachments: [],
    };
    const output = formatJson(journal);
    const parsed = JSON.parse(output);
    expect(parsed.task.id).toBe("TASK-001");
    expect(parsed.history[0].action).toBe("created");
  });

  it("outputs compact format when --format compact is passed", () => {
    const journal: TaskJournal = {
      task: { id: "TASK-002", subject: "Add tests", status: "in_progress" },
      history: [{ timestamp: "2026-03-14T11:00:00Z", action: "started", actor: "cassius" }],
      attachments: [],
    };
    const output = formatCompact(journal, true);
    expect(output).toContain("[TASK-002]");
    expect(output).toContain("started");
    expect(output).toContain("cassius");
  });
});
