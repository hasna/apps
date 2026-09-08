import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TodosClient } from "./client.js";
import { createTodosV1Client, resolveTodosSdkTransport } from "./resolve.js";
import { ApiError } from "./v1.generated.js";
import { TodosConflictError, TodosRateLimitError, TodosTimeoutError, TodosUnauthorizedError } from "./types.js";

let home: string;
let credentialFile: string;
let savedEnv: NodeJS.ProcessEnv;
const servers: Array<ReturnType<typeof Bun.serve>> = [];

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (/^(HASNA_|TODOS_)/.test(key)) delete process.env[key];
  }
  home = mkdtempSync(join(tmpdir(), "todos-sdk-authority-"));
  process.env.HOME = home;
  process.env.HASNA_HOME = join(home, ".hasna");
  process.env.HASNA_STATION = `sdk-fixture-${randomUUID()}`;
  credentialFile = join(home, ".hasna/todos/config/credentials");
  mkdirSync(dirname(credentialFile), { recursive: true });
});

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(home, { recursive: true, force: true });
});

function fixture(respond?: (request: Request) => Response | Promise<Response>) {
  const calls: Array<{ path: string; key: string | null }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      calls.push({ path, key: request.headers.get("x-api-key") });
      if (respond) return respond(request);
      return Response.json(path.includes("/v1/") ? { tasks: [], count: 0, total: 0 } : []);
    },
  });
  servers.push(server);
  const authority = new URL("gateway/todos", server.url).href;
  const save = (key: string, url = authority) => writeFileSync(
    credentialFile,
    `HASNA_TODOS_API_URL=${url}\nHASNA_TODOS_API_KEY=${key}\n`,
    { mode: 0o600 },
  );
  return { calls, authority, save };
}

for (const kind of ["namespaced", "v1"] as const) {
  describe(`${kind} SDK bound authority`, () => {
    const create = () => {
      expect(resolveTodosSdkTransport().mode).toBe("http");
      if (kind === "v1") {
        const client = createTodosV1Client();
        return { list: () => client.listTasks() };
      }
      const client = new TodosClient();
      return { list: () => client.tasks.list() };
    };

    test("saved key rotation works at one authority and a paired URL/key change sends nothing", async () => {
      const first = fixture();
      const other = fixture();
      first.save("fixture-before");
      const client = create();
      await client.list();
      first.save("fixture-after");
      await client.list();
      expect(first.calls.map(call => call.key)).toEqual(["fixture-before", "fixture-after"]);
      first.save("fixture-other", other.authority);
      await expect(client.list()).rejects.toThrow(/authority changed/);
      expect(first.calls).toHaveLength(2);
      expect(other.calls).toHaveLength(0);
    });

    test("removed credentials never fall back to the constructed key", async () => {
      const remote = fixture();
      remote.save("fixture-original");
      const client = create();
      rmSync(credentialFile);
      await expect(client.list()).rejects.toThrow();
      expect(remote.calls).toHaveLength(0);
    });

    test("an invalid replacement never falls back to the constructed key", async () => {
      const remote = fixture();
      remote.save("fixture-original");
      const client = create();
      remote.save("   ");
      await expect(client.list()).rejects.toThrow();
      expect(remote.calls).toHaveLength(0);
    });

    test("a blank compatibility alias does not freeze later environment rotation", async () => {
      const first = fixture();
      const other = fixture();
      process.env.HASNA_TODOS_API_URL = first.authority;
      process.env.HASNA_TODOS_API_KEY = "fixture-env-before";
      process.env.TODOS_API_KEY = "";
      const client = create();
      await client.list();
      process.env.HASNA_TODOS_API_KEY = "fixture-env-after";
      await client.list();
      expect(first.calls.map(call => call.key)).toEqual(["fixture-env-before", "fixture-env-after"]);
      process.env.HASNA_TODOS_API_URL = other.authority;
      process.env.HASNA_TODOS_API_KEY = "fixture-env-other";
      await expect(client.list()).rejects.toThrow(/authority changed/);
      expect(first.calls).toHaveLength(2);
      expect(other.calls).toHaveLength(0);
    });
  });
}

test("raw SDK reads keep their bound authority and cannot send a key to an arbitrary URL", async () => {
  const first = fixture();
  const other = fixture();
  first.save("fixture-raw");
  const client = new TodosClient();
  await expect(client._fetchRaw(`${other.authority}/api/tasks/export`)).rejects.toThrow();
  expect(first.calls).toHaveLength(0);
  expect(other.calls).toHaveLength(0);
});

test("raw SDK responses retain status, headers, CSV bytes and an unread SSE stream", async () => {
  const remote = fixture(request => {
    if (new URL(request.url).pathname.endsWith("/stream")) {
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("data: ready\n\n")); },
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("id,title\r\n1,fixture\r\n", {
      status: 206,
      headers: { "Content-Type": "text/csv", "X-Receipt": "fixture-receipt" },
    });
  });
  remote.save("fixture-raw");
  const client = new TodosClient({ timeout: 500 });
  const csv = await client._fetchRaw(`${remote.authority}/api/tasks/export`);
  expect(csv.status).toBe(206);
  expect(csv.headers.get("X-Receipt")).toBe("fixture-receipt");
  expect(await csv.text()).toBe("id,title\r\n1,fixture\r\n");
  const stream = await client._fetchRaw(`${remote.authority}/api/tasks/stream`);
  expect(stream.bodyUsed).toBe(false);
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: ready\n\n");
  await reader.cancel();
});

test("explicit authority does not consult ambient credentials, with or without an explicit key", async () => {
  const remote = fixture();
  remote.save("fixture-ambient");
  const anonymous = new TodosClient({ baseUrl: remote.authority });
  const explicit = new TodosClient({ baseUrl: remote.authority, apiKey: "fixture-explicit" });
  const v1 = createTodosV1Client({ baseUrl: remote.authority, apiKey: "fixture-explicit-v1" });
  writeFileSync(credentialFile, "not valid credential configuration", { mode: 0o600 });
  await anonymous.tasks.list();
  await explicit.tasks.list();
  await v1.listTasks();
  expect(remote.calls.map(call => call.key)).toEqual([null, "fixture-explicit", "fixture-explicit-v1"]);
});

test("raw and generated requests never follow redirects to another authority", async () => {
  const other = fixture();
  const remote = fixture(() => new Response(null, {
    status: 302, headers: { Location: `${other.authority}/api/tasks` },
  }));
  remote.save("fixture-redirect");
  const client = new TodosClient();
  const raw = await client._fetchRaw(`${remote.authority}/api/tasks/export`);
  expect(raw.status).toBe(302);
  await raw.body?.cancel();
  await expect(client.tasks.list()).rejects.toThrow();
  await expect(createTodosV1Client().listTasks()).rejects.toThrow();
  expect(other.calls).toHaveLength(0);
});

test("caller auth headers cannot replace the resolved credential", async () => {
  const remote = fixture();
  remote.save("fixture-bound");
  const client = new TodosClient();
  await expect(client._fetchRaw(`${remote.authority}/api/tasks/export`, {
    headers: { "X-API-Key": "fixture-unrelated", Authorization: "Bearer fixture-unrelated" },
  })).rejects.toThrow();
  await expect(createTodosV1Client({ headers: { "X-API-Key": "fixture-unrelated" } }).listTasks()).rejects.toThrow();
  expect(remote.calls).toHaveLength(0);
});

test("JSON typed errors, response bodies and configured retry counts stay intact", async () => {
  let status = 401;
  const remote = fixture(() => Response.json({ error: "fixture-diagnostic" }, {
    status, headers: { "Retry-After": "0" },
  }));
  remote.save("fixture-errors");
  const client = new TodosClient({ maxRetries: 1, retryDelay: 0 });
  await expect(client.tasks.list()).rejects.toBeInstanceOf(TodosUnauthorizedError);
  expect(remote.calls).toHaveLength(1);
  status = 409;
  await expect(client.tasks.list()).rejects.toBeInstanceOf(TodosConflictError);
  expect(remote.calls).toHaveLength(2);
  status = 429;
  let limited: unknown;
  try { await client.tasks.list(); } catch (error) { limited = error; }
  expect(limited).toBeInstanceOf(TodosRateLimitError);
  expect((limited as TodosRateLimitError).retryAfter).toBe(0);
  expect((limited as TodosRateLimitError).body).toEqual({ error: "fixture-diagnostic" });
  expect(remote.calls).toHaveLength(4);
  status = 409;
  let generatedError: unknown;
  try { await createTodosV1Client().listTasks(); } catch (error) { generatedError = error; }
  expect(generatedError).toBeInstanceOf(ApiError);
  expect((generatedError as ApiError).status).toBe(409);
  expect((generatedError as ApiError).body).toEqual({ error: "fixture-diagnostic" });
  expect(remote.calls).toHaveLength(5);
});

test("JSON deadline retains its typed error and raw caller cancellation remains active", async () => {
  const remote = fixture(async () => { await Bun.sleep(100); return Response.json([]); });
  remote.save("fixture-timeout");
  const client = new TodosClient({ baseUrl: remote.authority, apiKey: "fixture-timeout", timeout: 20 });
  await expect(client.tasks.list()).rejects.toBeInstanceOf(TodosTimeoutError);
  expect(remote.calls).toHaveLength(1);
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(client._fetchRaw(`${remote.authority}/api/tasks/export`, { signal: cancelled.signal })).rejects.toThrow();
  expect(remote.calls).toHaveLength(1);
});
