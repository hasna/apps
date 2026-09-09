import { expect, test } from "bun:test";
import { HostedRecordingsClient } from "../hosted/index.js";

const apiBase = "https://fictional.example.test/api/v1/";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fakeFetch = (body: () => Response): typeof fetch => (async (_url, _init) => body()) as typeof fetch;

test("encoded JSON bounds reject valid large input before credentials or fetch", async () => {
  let credentials = 0, calls = 0;
  const client = new HostedRecordingsClient({ apiBase,
    credentialProvider: () => { credentials++; return "fictional-access"; },
    fetch: fakeFetch(() => { calls++; return Response.json({}); }),
  });
  await expect(client.saveRecording({ id, title: "Fictional", transcript: "\u0000".repeat(256_000), durationMs: 1 }))
    .rejects.toMatchObject({ code: "invalid_input" });
  expect(credentials).toBe(0); expect(calls).toBe(0);
});

test("diagnostic request ID accepts real UUIDs and omits malformed hex/hyphen strings", async () => {
  for (const requestId of ["-".repeat(36), "a".repeat(36), "aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa"]) {
    const client = new HostedRecordingsClient({ apiBase, fetch: fakeFetch(() => new Response(null, { status: 500, headers: { "x-request-id": requestId } })) });
    await expect(client.health()).rejects.toMatchObject({ code: "http_error", status: 500, requestId: undefined });
  }
  for (const requestId of [id, id.toUpperCase()]) {
    const client = new HostedRecordingsClient({ apiBase, fetch: fakeFetch(() => new Response(null, { status: 500, headers: { "x-request-id": requestId } })) });
    await expect(client.health()).rejects.toMatchObject({ code: "http_error", status: 500, requestId });
  }
});

test("synchronous credential cancellation observes the original rejected promise", async () => {
  // Use a child so a broken implementation's unhandled rejection cannot affect other tests.
  const module = new URL("../hosted/index.ts", import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, "-e", `
    import { HostedRecordingsClient } from ${JSON.stringify(module)};
    const unhandled = [];
    process.on("unhandledRejection", error => unhandled.push(error));
    const cancel = new AbortController(); let calls = 0;
    const original = new Error("FICTIONAL_CREDENTIAL_CANARY");
    const client = new HostedRecordingsClient({ apiBase: "https://fictional.example.test/api/v1/",
      credentialProvider: () => { cancel.abort(); return Promise.reject(original); },
      fetch: async () => { calls++; return Response.json({}); },
    });
    let code; try { await client.account({ signal: cancel.signal }); } catch (error) { code = error.code; }
    await new Promise(resolve => setTimeout(resolve, 20));
    console.log(JSON.stringify({code, calls, unhandled: unhandled.length}));
  `], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status).toBe(0); expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ code: "aborted", calls: 0, unhandled: 0 });
});
