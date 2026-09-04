import { expect, test } from "bun:test";
import { createClientTransport, resolveClientTransport, resolveCredential } from "../src/client/transport";

const quiet = {};
const configured = () => ({ HASNA_SNAPSHOT_API_URL: "https://snapshot.example.test", HASNA_SNAPSHOT_API_KEY: "fixture-key-a" });

for (const key of ["HASNA_SNAPSHOT_API_URL", "SNAPSHOT_API_URL", "HASNA_SNAPSHOT_API_KEY", "SNAPSHOT_API_KEY", "HASNA_SNAPSHOT_API_KEY_OVERRIDE", "HASNA_SNAPSHOT_API_KEY_REF", "HASNA_PROFILE", "HOME", "XDG_CONFIG_HOME"]) {
  test(`rejects own accessor ${key} without invoking it or fetching`, () => {
    const env = configured();
    let reads = 0, fetches = 0;
    Object.defineProperty(env, key, { enumerable: true, get() { reads++; return "fixture-accessor"; } });
    expect(() => createClientTransport("snapshot", env, { credentials: quiet, fetchImpl: async () => { fetches++; return Response.json({}); } })).toThrow(/accessor/i);
    expect(reads).toBe(0);
    expect(fetches).toBe(0);
  });
}

test("getter cycle cannot validate one alias value then dispatch another", async () => {
  const env = { ...configured(), SNAPSHOT_API_KEY: "fixture-key-a" };
  let reads = 0, fetches = 0;
  Object.defineProperty(env, "HASNA_SNAPSHOT_API_KEY", { get() { return ++reads % 3 === 0 ? "fixture-key-b" : "fixture-key-a"; } });
  await expect((async () => {
    const { client } = createClientTransport("snapshot", env, { credentials: quiet, fetchImpl: async () => { fetches++; return Response.json({}); } });
    await client.get("/notes");
  })()).rejects.toThrow(/accessor/i);
  expect(reads).toBe(0);
  expect(fetches).toBe(0);
});

test("direct credential resolver rejects accessor aliases too", () => {
  const env = configured();
  let reads = 0;
  Object.defineProperty(env, "HASNA_SNAPSHOT_API_KEY", { get() { reads++; return "fixture-key-a"; } });
  expect(() => resolveCredential("snapshot", env, quiet)).toThrow(/accessor/i);
  expect(reads).toBe(0);
});

test("ordinary data aliases remain fail-closed on conflicts", () => {
  expect(() => resolveClientTransport("snapshot", { ...configured(), SNAPSHOT_API_URL: "https://other.example.test" }, { credentials: quiet })).toThrow(/disagree/);
  expect(() => resolveCredential("snapshot", { ...configured(), SNAPSHOT_API_KEY: "fixture-key-b" }, quiet)).toThrow(/disagree/);
  expect(resolveClientTransport("snapshot", { ...configured(), SNAPSHOT_API_KEY: "fixture-key-a" }, { credentials: quiet }).baseUrl).toBe("https://snapshot.example.test/v1");
});

test("plain environment supports key rotation but refuses authority rotation", async () => {
  const env = configured();
  const sent: string[] = [];
  const { client } = createClientTransport("snapshot", env, { credentials: quiet, retry: false, fetchImpl: async (_url, init) => { sent.push(new Headers(init?.headers).get("x-api-key")!); return Response.json({}); } });
  await client.get("/notes");
  env.HASNA_SNAPSHOT_API_KEY = "fixture-key-b";
  await client.get("/notes");
  env.HASNA_SNAPSHOT_API_URL = "https://other.example.test";
  await expect(client.get("/notes")).rejects.toThrow(/authority changed/i);
  expect(sent).toEqual(["fixture-key-a", "fixture-key-b"]);
});

test("real process.env remains a valid data-descriptor input", () => {
  expect(resolveCredential("contracts-env-snapshot-probe", process.env, { apiKey: "fixture-explicit-key" })?.apiKey).toBe("fixture-explicit-key");
});
