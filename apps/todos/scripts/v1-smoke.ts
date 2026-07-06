#!/usr/bin/env bun
/**
 * In-process smoke test for the cloud /v1 API. Starts todos-serve in remote mode
 * and drives a full authenticated CRUD roundtrip against the live RDS.
 *
 * Requires: HASNA_TODOS_DATABASE_URL, HASNA_TODOS_API_SIGNING_KEY, TODOS_V1_TOKEN.
 * Usage: bun run scripts/v1-smoke.ts
 */
import { startServer } from "../src/server/serve.js";
import { TodosV1Client } from "../src/sdk/v1.generated.js";

const PORT = Number(process.env.TODOS_V1_SMOKE_PORT ?? 19471);
const TOKEN = process.env.TODOS_V1_TOKEN;
if (!TOKEN) throw new Error("TODOS_V1_TOKEN is required");
const B = `http://127.0.0.1:${PORT}`;
const H = { "x-api-key": TOKEN, "Content-Type": "application/json" };

function ok(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!cond) process.exitCode = 1;
}

await startServer(PORT, { open: false, host: "127.0.0.1" });
await new Promise((r) => setTimeout(r, 500));

try {
  const health = await (await fetch(`${B}/health`)).json();
  ok("/health", health.status === "ok" && health.mode === "remote", JSON.stringify(health));
  const version = await (await fetch(`${B}/version`)).json();
  ok("/version", typeof version.version === "string" && version.mode === "remote", JSON.stringify(version));
  const ready = await (await fetch(`${B}/ready`)).json();
  ok("/ready", ready.status === "ready", JSON.stringify(ready));

  const noauth = await fetch(`${B}/v1/tasks`);
  ok("/v1 requires auth (401)", noauth.status === 401);

  const created = await fetch(`${B}/v1/tasks`, { method: "POST", headers: H, body: JSON.stringify({ title: "v1 smoke", priority: "high", tags: ["smoke"] }) });
  const createdBody = await created.json();
  const id = createdBody.task?.id;
  ok("CREATE task (201)", created.status === 201 && !!id, `id=${id}`);

  const got = await (await fetch(`${B}/v1/tasks/${id}`, { headers: H })).json();
  ok("GET task", got.task?.id === id);

  const list = await (await fetch(`${B}/v1/tasks?limit=5`, { headers: H })).json();
  ok("LIST tasks", typeof list.count === "number");

  const upd = await fetch(`${B}/v1/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ title: "v1 smoke DONE", status: "in_progress" }) });
  const updBody = await upd.json();
  ok("UPDATE task", upd.status === 200 && updBody.task?.status === "in_progress" && updBody.task?.title === "v1 smoke DONE", JSON.stringify(updBody.task && { v: updBody.task.version }));

  const conflict = await fetch(`${B}/v1/tasks/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "done", version: 1 }) });
  ok("stale version -> 409", conflict.status === 409);

  const del = await (await fetch(`${B}/v1/tasks/${id}`, { method: "DELETE", headers: H })).json();
  ok("DELETE task", del.deleted === true);

  const after = await fetch(`${B}/v1/tasks/${id}`, { headers: H });
  ok("GET after delete -> 404", after.status === 404);

  // ── Roundtrip through the GENERATED SDK client (the "real client") ──
  const spec = await (await fetch(`${B}/openapi.json`)).json();
  ok("GET /openapi.json", spec.openapi?.startsWith("3.") && !!spec.paths["/v1/tasks"]);
  const client = new TodosV1Client({ baseUrl: B, apiKey: TOKEN });
  const sdkCreated = await client.createTask({ title: "sdk client task", priority: "medium" });
  const sdkId = sdkCreated.task?.id as string;
  ok("SDK createTask", !!sdkId, `id=${sdkId}`);
  const sdkGot = await client.getTask(sdkId);
  ok("SDK getTask", sdkGot.task?.id === sdkId);
  const sdkUpd = await client.updateTask(sdkId, { status: "in_progress" });
  ok("SDK updateTask", sdkUpd.task?.status === "in_progress");
  const sdkDel = await client.deleteTask(sdkId);
  ok("SDK deleteTask", sdkDel.deleted === true);
} finally {
  process.exit(process.exitCode ?? 0);
}
