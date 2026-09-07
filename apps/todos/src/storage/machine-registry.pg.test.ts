import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { createPostgresTodosSyncStore } from "./postgres-sync.js";
import { createPostgresMachineRegistry } from "./machine-registry.js";
import { handleV1Request, normalizeImportSnapshot, type V1RequestDependencies } from "../server/v1.js";
import type { Machine } from "../types/index.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const pgUrl = process.env.TODOS_TEST_PG_URL;
const table = `todos_machine_fixture_${randomUUID().replaceAll("-", "")}`;
const fixture = (id: string): Machine => ({ id, name: id, hostname: null, platform: "darwin", ssh_address: "fixture.example.test", metadata: { workspace_path: "/fixture/workspace", nested: { array: [false, 2] } }, is_primary: false, archived_at: null, last_seen_at: "2026-09-06T12:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z" });

describe.skipIf(!pgUrl)("machine registry actual PostgreSQL and authenticated handler", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;
  beforeAll(async () => { client = createTodosCloudQueryClient(pgUrl!); store = createPostgresTodosStorageAdapter({ client, service: "machine-fixture", tableName: table, cursorTableName: `${table}_cursor` }); });
  afterAll(async () => { await client.query(`DROP TABLE IF EXISTS ${table}, ${table}_cursor`); await client.close(); });
  test("imports two complete identities, preserves references, and replays without mutation", async () => {
    const rows = [{ ...fixture("station04"), is_primary: true }, { ...fixture("station03"), archived_at: "2026-08-31T12:00:00.000Z" }];
    const snapshot = normalizeImportSnapshot({ machines: rows });
    const first = await store.sync.importSnapshot!(snapshot);
    expect(first).toMatchObject({ inserted: 2, skipped: 0, errors: [] });
    expect((await store.sync.exportSnapshot!()).machines?.sort((a,b) => a.id.localeCompare(b.id))).toEqual([...rows].sort((a,b) => a.id.localeCompare(b.id)));
    expect(await store.sync.importSnapshot!(snapshot)).toMatchObject({ inserted: 0, skipped: 2, errors: [] });
    const task = await store.tasks.create({ title: "fixture machine ownership" });
    await client.query(`UPDATE ${table} SET payload=$3::text::jsonb WHERE service=$1 AND object_id=$2`, ["machine-fixture",task.id,JSON.stringify({ ...task, machine_id: "station04" })]);
    expect((await store.tasks.get(task.id))?.machine_id).toBe("station04");
    expect((await store.sync.exportSnapshot!()).machines).toHaveLength(2);
  });
  test("conflicting batch is atomic and same-name concurrent registration preserves one identity", async () => {
    const before = await store.machines!.list();
    await expect(store.machines!.execute({ action: "import", machines: [fixture("new-prefix"), { ...fixture("other-id"), name: "station04" }] })).rejects.toThrow("different identity");
    expect(await store.machines!.list()).toEqual(before);
    const [a,b] = await Promise.all([store.machines!.execute({ action: "register", name: "concurrent" }), store.machines!.execute({ action: "register", name: "concurrent" })]);
    expect(a.machine!.id).toBe(b.machine!.id);
    expect((await store.machines!.list()).filter(row => row.name === "concurrent")).toHaveLength(1);
  });
  test("service isolation, single primary, and referenced machine deletion protection", async () => {
    const isolated = createPostgresMachineRegistry(client, "other-service", table, async () => {});
    expect(await isolated.list()).toEqual([]);
    const row = (await store.machines!.execute({ action: "register", name: "new-primary", options: { primary: true } })).machine!;
    expect((await store.machines!.list()).filter(item => item.is_primary).map(item => item.id)).toEqual([row.id]);
    await expect(store.machines!.execute({ action: "delete", name: "station04" })).rejects.toThrow("referenced");
    await expect(store.machines!.execute({ action: "archive", name: "new-primary" })).rejects.toThrow("primary");
    await expect(store.machines!.execute({ action: "set-primary", name: "station03" })).rejects.toThrow("archived");
  });
  test("real API scope decisions happen before writes; invalid input and missing capabilities fail honestly", async () => {
    const dependencies: V1RequestDependencies = {
      ensureSchema: async () => {}, getStorageAdapter: () => store,
      getVerifier: () => ({ authenticate: async (_headers: Headers, request: { requiredScopes: string[] }) => request.requiredScopes.includes("todos:write") ? { ok: false, status: 403, message: "fixture read-only", reason: "scope" } : { ok: true, principal: { agent: null, scopes: ["todos:read"] } } }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
    };
    const url = new URL("http://fixture.test/v1/machines");
    const read = await handleV1Request(new Request(url),url,dependencies);
    expect(read?.status).toBe(200); expect((await read!.json()).schema_version).toBe(1);
    const write = await handleV1Request(new Request(url, { method: "POST", body: JSON.stringify({ action: "register", name: "must-not-exist" }) }),url,dependencies);
    expect(write?.status).toBe(403);
    expect((await store.machines!.list()).some(row => row.name === "must-not-exist")).toBe(false);
    const missing = await handleV1Request(new Request(url),url,{ ...dependencies, getStorageAdapter: () => ({ ...store, machines: undefined }) });
    expect(missing?.status).toBe(501);
    await expect(store.machines!.execute({ action: "import", machines: [ { ...fixture("invalid"), metadata: null } as never ] })).rejects.toThrow("metadata");
  });
  test("standalone sync retains machine rows and rejects lifecycle bypass tombstones", async () => {
    const sync = createPostgresTodosSyncStore(client, { service: "sync-fixture", tableName: table, cursorTableName: `${table}_cursor` });
    const snapshot = normalizeImportSnapshot({ machines: [fixture("sync-identity")] });
    expect(await sync.pushSnapshot(snapshot)).toEqual({ records: 1, objectTypes: { machines: 1 } });
    expect((await sync.pullSnapshot()).machines).toEqual(snapshot.machines);
    expect(await sync.pushSnapshot(snapshot)).toEqual({ records: 1, objectTypes: { machines: 1 } });
    const malicious = normalizeImportSnapshot({ machines: [fixture("must-not-import")], tombstones: [{object_type:"machines",object_id:"station04",deleted_at:"2026-09-07T00:00:00Z",updated_at:"2026-09-07T00:00:00Z"}] });
    expect((await store.sync.importSnapshot!(malicious)).errors).toEqual(["Machine tombstones require explicit registry lifecycle operations"]);
    expect((await store.machines!.list()).some(row => row.id === "must-not-import")).toBe(false);
  });
  test("ambiguous name-versus-ID selectors cannot mutate either imported identity", async () => {
    const rows = [fixture("selector-id"), { ...fixture("other-selector-id"), name: "selector-id" }];
    rows[0]!.name = "selector-name";
    await store.machines!.execute({ action: "import", machines: rows });
    const before = await store.machines!.list();
    for (const action of ["heartbeat", "archive", "delete"] as const) await expect(store.machines!.execute({ action, name: "selector-id" })).rejects.toThrow("ambiguous");
    expect(await store.machines!.list()).toEqual(before);
  });
  test("real handler fences configured deployment tenant on reads, writes and snapshot imports", async () => {
    const deps = (tid: string | null): V1RequestDependencies => ({
      ensureSchema: async () => {}, getStorageAdapter: () => store, getMachineRegistryTenantId: () => "fixture-tenant-a",
      getVerifier: () => ({ authenticate: async () => ({ ok: true, principal: { agent: null, tid, scopes: ["todos:*"] } }) }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
    });
    for (const tid of ["fixture-tenant-b", null]) {
      for (const [path,method,body] of [["/v1/machines","GET",null],["/v1/machines","POST",{action:"register",name:"foreign-tenant"}],["/v1/import","POST",{machines:[fixture("foreign-import")]}]] as const) {
        const url=new URL(`http://fixture.test${path}`);
        const result=await handleV1Request(new Request(url,{method,...(body ? {body:JSON.stringify(body)} : {})}),url,deps(tid));
        expect(result?.status).toBe(403);
      }
    }
    const url=new URL("http://fixture.test/v1/machines");
    expect((await handleV1Request(new Request(url),url,deps("fixture-tenant-a")))?.status).toBe(200);
    expect((await store.machines!.list()).some(row => row.name.startsWith("foreign-"))).toBe(false);
  });
  test("retired stable ID cannot be resurrected by import or explicit register", async () => {
    const row = (await store.machines!.execute({ action: "register", name: "retirable", id: "stable-retired" })).machine!;
    expect((await store.machines!.execute({ action: "delete", name: row.name })).deleted).toBe(true);
    await expect(store.machines!.execute({ action: "import", machines: [row] })).rejects.toThrow("retired");
    await expect(store.machines!.execute({ action: "register", name: row.name, id: row.id })).rejects.toThrow("retired");
  });
});
