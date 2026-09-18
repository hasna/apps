import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "../../core/store";

const scratch = mkdtempSync(join(tmpdir(), "attachments-hosted-todos-"));
const saved = { ...process.env };
const base = "https://services.example.test/todos";
const attachment = { id: "att_one", filename: "proof.txt", size: 4, link: null };
const get = mock(async () => attachment);
const uploadFile = mock(async () => attachment);
const list = mock(async () => [attachment]);
const close = mock(() => {});
const store = { get, uploadFile, list, close } as unknown as Store;
mock.module("../../core/store", () => ({ resolveStore: () => store }));
const { fetchTaskMeta, fetchTaskHistory, buildTaskJournal } = await import("./task-journal");
const { linkAttachmentToTask } = await import("./link-task");
const { completeTaskWithFiles } = await import("./complete-task");
const { resolveEvidence } = await import("./resolve-evidence");

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(HASNA_|TODOS_|SESSIONS_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    HASNA_HOME: scratch, HASNA_CONFIG_HOME: scratch, HASNA_STATION: "attachments-hermetic-test",
    HASNA_TODOS_API_URL: base, HASNA_TODOS_API_KEY: "synthetic-fixture-key",
  });
  get.mockReset(); get.mockImplementation(async () => attachment);
  uploadFile.mockClear(); list.mockClear(); close.mockClear();
});
afterAll(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); rmSync(scratch, { recursive: true }); });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("journal reads the configured v1 prefix and task/history envelopes", async () => {
  const calls: string[] = [];
  const request = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    expect(new Headers(init?.headers).get("x-api-key")).toBe("synthetic-fixture-key");
    expect(init?.redirect).toBe("error");
    if (url === base + "/v1/tasks/task-one/history") return response({ history: [{ action: "created", created_at: "2026-01-01T00:00:00Z", agent_id: "fixture" }], count: 1 });
    if (url === base + "/v1/tasks/task-one") return response({ task: { id: "task-one", title: "Evidence task", assigned_to: "fixture", status: "pending", version: 4, metadata: {} } });
    return response({ error: "route absent" }, 404);
  }) as typeof fetch;
  const { journal, todosReachable } = await buildTaskJournal("task-one", { todosUrl: base }, request, () => store);
  expect(todosReachable).toBe(true);
  expect(journal.task.subject).toBe("Evidence task");
  expect(journal.history).toEqual([{ action: "created", timestamp: "2026-01-01T00:00:00Z", actor: "fixture", details: undefined, progress: undefined }]);
  expect(calls.sort()).toEqual([base + "/v1/tasks/task-one", base + "/v1/tasks/task-one/history"]);
});

test("journal does not turn a failed history request into successful empty history", async () => {
  const request = mock(async (url: string | URL | Request) => String(url).endsWith("/history")
    ? response({ detail: "private-error-marker" }, 503)
    : response({ task: { id: "task-one", title: "Evidence task", version: 4 } })) as typeof fetch;
  await expect(buildTaskJournal("task-one", { todosUrl: base }, request, () => store)).rejects.toThrow("HTTP 503");
  expect(list).not.toHaveBeenCalled();
});

test("history rejects a malformed success envelope and preserves genuinely empty history", async () => {
  await expect(fetchTaskHistory("task-one", base, mock(async () => response({ unexpected: [] })) as typeof fetch)).rejects.toThrow();
  expect(await fetchTaskHistory("task-one", base, mock(async () => response({ history: [], count: 0 })) as typeof fetch)).toEqual([]);
});

test("task metadata failure is terminal and redacts the response body", async () => {
  let message = "";
  try { await fetchTaskMeta("task-one", base, mock(async () => response({ detail: "private-error-marker" }, 403)) as typeof fetch); }
  catch (error) { message = (error as Error).message; }
  expect(message).toContain("HTTP 403");
  expect(message).not.toContain("private-error-marker");
});

test("link-task merges existing attachments and unrelated metadata with an observed version", async () => {
  let patch: Record<string, unknown> | undefined;
  const request = mock(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(base + "/v1/tasks/task-one");
    if (init?.method === "PATCH") { patch = JSON.parse(String(init.body)); return response({ task: { id: "task-one", version: 8, metadata: patch!.metadata } }); }
    return response({ task: { id: "task-one", version: 7, metadata: { keep: "untouched", _attachments: [{ id: "att_previous", filename: "before.txt", size: 2, link: null }] } } });
  }) as typeof fetch;
  await linkAttachmentToTask("att_one", "task-one", base, request);
  expect(patch).toEqual({ version: 7, metadata: { keep: "untouched", _attachments: [{ id: "att_previous", filename: "before.txt", size: 2, link: null }, attachment] } });
});

test("completion checks the task before any attachment upload", async () => {
  await expect(completeTaskWithFiles("missing-task", ["proof.txt"], { todosUrl: base }, () => store,
    mock(async () => response({ error: "not found" }, 404)) as typeof fetch)).rejects.toThrow("Task not found");
  expect(uploadFile).not.toHaveBeenCalled();
});

test("completion consumes current envelopes and persists merged evidence before completion", async () => {
  const operations: string[] = []; let patch: any;
  const request = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET"; operations.push(method + " " + String(url));
    if (method === "GET") return response({ task: { id: "task-one", version: 3, metadata: { keep: true, _evidence: { note: "existing", attachments: [] } } } });
    if (method === "PATCH") { patch = JSON.parse(String(init?.body)); return response({ task: { id: "task-one", version: 4, metadata: patch.metadata } }); }
    return response({ task: { id: "task-one", version: 5, status: "completed", metadata: patch.metadata } });
  }) as typeof fetch;
  const result = await completeTaskWithFiles("task-one", ["proof.txt"], { todosUrl: base }, () => store, request);
  expect(patch.version).toBe(3); expect(patch.metadata.keep).toBe(true); expect(patch.metadata._evidence.note).toBe("existing");
  expect(patch.metadata._evidence.attachments).toEqual([attachment]);
  expect(operations).toEqual(["GET " + base + "/v1/tasks/task-one", "PATCH " + base + "/v1/tasks/task-one", "POST " + base + "/v1/tasks/task-one/complete"]);
  expect(result.attachment_ids).toEqual(["att_one"]);
});

test("evidence reads the hosted task envelope and refuses a missing authoritative attachment", async () => {
  const request = mock(async () => response({ task: { id: "task-one", metadata: { _evidence: { attachments: [attachment] } } } })) as typeof fetch;
  expect(await resolveEvidence("task-one", { todosUrl: base }, request)).toEqual([attachment]);
  get.mockImplementation(async () => null as never);
  await expect(resolveEvidence("task-one", { todosUrl: base }, request)).rejects.toThrow("att_one");
});

for (const version of [undefined, 0, 1.5, "4"]) test(`completion refuses invalid write version ${version} before upload`, async () => {
  const request = mock(async () => response({ task: { id: "task-one", version, metadata: {} } })) as typeof fetch;
  await expect(completeTaskWithFiles("task-one", ["proof.txt"], { todosUrl: base }, () => store, request)).rejects.toThrow("write version");
  expect(uploadFile).not.toHaveBeenCalled();
});

test("completion conflict never retries the write or marks the task complete", async () => {
  const request = mock(async (_url: unknown, init?: RequestInit) => init?.method === "PATCH"
    ? response({ detail: "private-error-marker" }, 409)
    : response({ task: { id: "task-one", version: 2, metadata: {} } })) as typeof fetch;
  await expect(completeTaskWithFiles("task-one", ["proof.txt"], { todosUrl: base }, () => store, request)).rejects.toThrow("HTTP 409");
  expect(request).toHaveBeenCalledTimes(2);
  expect(uploadFile).toHaveBeenCalledTimes(1);
});

test("completion stops after a mismatched evidence acknowledgement", async () => {
  const request = mock(async (_url: unknown, init?: RequestInit) => response({ task: { id: "task-one", version: init?.method === "PATCH" ? 3 : 2, metadata: {} } })) as typeof fetch;
  await expect(completeTaskWithFiles("task-one", ["proof.txt"], { todosUrl: base }, () => store, request)).rejects.toThrow("acknowledgement");
  expect(request).toHaveBeenCalledTimes(2);
});

test("journal follows the resolved task identity for history and attachment tags", async () => {
  const urls: string[] = [];
  const request = mock(async (url: unknown) => { urls.push(String(url)); return String(url).endsWith("/history") ? response({ history: [], count: 0 }) : response({ task: { id: "canonical-task", title: "Fixture" } }); }) as typeof fetch;
  await buildTaskJournal("short-ref", { todosUrl: base }, request, () => store);
  expect(urls).toEqual([base + "/v1/tasks/short-ref", base + "/v1/tasks/canonical-task/history"]);
  expect(list).toHaveBeenCalledWith({ tag: "task:canonical-task", includeExpired: true });
});

test("task references cannot inject a second path or leak credentials to another authority", async () => {
  const { readTodosTask, withTodosAuth } = await import("../../core/todos");
  const request = mock(async () => response({ task: { id: "fixture" } })) as typeof fetch;
  await readTodosTask("a/b?c#d", base + "/v1", request);
  expect((request as ReturnType<typeof mock>).mock.calls[0][0]).toBe(base + "/v1/tasks/a%2Fb%3Fc%23d");
  await expect(withTodosAuth(base + "/api/tasks/task-one")).rejects.toThrow();
  await expect(withTodosAuth("https://elsewhere.example.test/v1/tasks/task-one")).rejects.toThrow();
});
