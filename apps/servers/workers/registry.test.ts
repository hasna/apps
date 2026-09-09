import { describe, expect, test } from "bun:test";
import { PreviewRegistry } from "./registry";
import { CONTROL_PATH, LEASE_DURATION_MS, type PreviewRecord } from "./shared";
import { MemoryStorage } from "./test-storage";

const key = "studio/web/dev/main";
const hostname = "studio-web-dev.example.workers.dev";
const token = "control".repeat(8);

async function fixture() {
  let now = 10_000;
  const storage = new MemoryStorage();
  const registry = new PreviewRegistry({ storage }, { CONTROL_TOKEN: token }, () => now);
  await registry.execute({ action: "register-station", station: { id: "station-a", binding: "STATION_A" } });
  await registry.execute({ action: "register-station", station: { id: "station-b", binding: "STATION_B" } });
  await registry.execute({ action: "register-preview", preview: { key, hostname } });
  const claim = (stationId = "station-a", instanceId = "instance-a", takeover = false) =>
    registry.execute({ action: "claim", key, stationId, instanceId, takeover }) as Promise<PreviewRecord>;
  return { registry, storage, claim, setNow: (value: number) => { now = value; } };
}

describe("preview ownership registry", () => {
  test("simultaneous claims have exactly one winner", async () => {
    const { registry, claim } = await fixture();
    const claims = await Promise.allSettled([claim(), claim("station-b", "instance-b")]);
    expect(claims.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((value) => value.status === "rejected")).toHaveLength(1);
    const active = await registry.execute({ action: "status", key }) as PreviewRecord;
    expect(active.fence).toBe(1);
    expect(active.expiresAt).toBe(10_000 + LEASE_DURATION_MS);
  });

  test("takeover fences off old heartbeat and release without touching another product", async () => {
    const { registry, claim } = await fixture();
    const otherKey = "commerce/api/dev/main";
    await registry.execute({ action: "register-preview", preview: { key: otherKey, hostname: "commerce-api.example.workers.dev" } });
    const other = await registry.execute({ action: "claim", key: otherKey, stationId: "station-a", instanceId: "other" });
    const old = await claim();
    const current = await claim("station-b", "instance-b", true);
    expect(current.fence).toBe(old.fence + 1);
    for (const action of ["heartbeat", "release"]) {
      await expect(registry.execute({ action, ...old })).rejects.toMatchObject({ code: "STALE_LEASE", status: 409 });
    }
    expect(await registry.execute({ action: "status", key })).toEqual(current);
    expect(await registry.execute({ action: "status", key: otherKey })).toEqual(other);
  });

  test("expired lease cannot revive; a fresh claim increments fence", async () => {
    const { registry, claim, setNow } = await fixture();
    const old = await claim();
    setNow(old.expiresAt);
    await expect(registry.execute({ action: "heartbeat", ...old })).rejects.toMatchObject({ code: "STALE_LEASE" });
    const current = await claim();
    expect(current.fence).toBe(old.fence + 1);
    expect(current.expiresAt).toBe(old.expiresAt + LEASE_DURATION_MS);
  });

  test("idempotent same-instance claim, heartbeat and release are fenced", async () => {
    const { registry, claim, setNow } = await fixture();
    const first = await claim();
    setNow(15_000);
    const second = await claim();
    expect(second.fence).toBe(first.fence);
    expect(second.expiresAt).toBe(15_000 + LEASE_DURATION_MS);
    setNow(20_000);
    const heartbeat = await registry.execute({ action: "heartbeat", ...second }) as PreviewRecord;
    expect(heartbeat.expiresAt).toBe(20_000 + LEASE_DURATION_MS);
    const released = await registry.execute({ action: "release", ...heartbeat }) as PreviewRecord;
    expect(released.stationId).toBeUndefined();
    expect(released.expiresAt).toBe(0);
    expect(released.fence).toBe(first.fence + 1);
    await expect(registry.execute({ action: "release", ...heartbeat })).rejects.toMatchObject({ code: "STALE_LEASE" });
  });

  test("identities are immutable, hostnames unique, secrets not persisted", async () => {
    const { registry, storage } = await fixture();
    await expect(registry.execute({ action: "register-preview", preview: { key, hostname: "other.example.workers.dev" } }))
      .rejects.toMatchObject({ code: "IMMUTABLE_IDENTITY" });
    await expect(registry.execute({ action: "register-preview", preview: { key: "studio/api/dev/main", hostname } }))
      .rejects.toMatchObject({ code: "HOSTNAME_IN_USE" });
    await expect(registry.execute({ action: "register-station", station: { id: "station-a", binding: "STATION_OTHER" } }))
      .rejects.toMatchObject({ code: "IMMUTABLE_IDENTITY" });
    const station = await registry.execute({ action: "register-station", station: { id: "station-a", binding: "STATION_A", secret: "do-not-persist" } });
    expect(station).toEqual({ id: "station-a", binding: "STATION_A" });
    expect(JSON.stringify([...await storage.list({ prefix: "" })])).not.toContain("do-not-persist");
  });

  test("rejects unknown stations, malformed identities, and unknown previews", async () => {
    const { registry, claim } = await fixture();
    await expect(claim("missing")).rejects.toMatchObject({ code: "UNKNOWN_STATION" });
    await expect(registry.execute({ action: "claim", key: "studio/api/dev/main", stationId: "station-a", instanceId: "a" }))
      .rejects.toMatchObject({ code: "UNKNOWN_PREVIEW" });
    await expect(registry.execute({ action: "status", key: "studio/../dev/main" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(registry.execute({ action: "register-station", station: { id: "station-c", binding: "CONTROL_TOKEN" } }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("list filters product scope exactly", async () => {
    const { registry } = await fixture();
    await registry.execute({ action: "register-preview", preview: { key: "studio-other/web/dev/main", hostname: "other.example.workers.dev" } });
    expect(await registry.execute({ action: "list", product: "studio" })).toHaveLength(1);
    expect(await registry.execute({ action: "list" })).toHaveLength(2);
  });

  test("HTTP requires bearer authentication and limits JSON input", async () => {
    const { registry } = await fixture();
    const request = (body: string, authenticated = true) => new Request(`https://registry.internal${CONTROL_PATH}`, {
      method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) }, body,
    });
    expect((await registry.fetch(request('{"action":"list"}', false))).status).toBe(403);
    expect((await registry.fetch(request("{"))).status).toBe(400);
    const oversized = request(JSON.stringify({ action: "list", padding: "a".repeat(17_000) }));
    expect((await registry.fetch(oversized)).status).toBe(413);
    expect((await registry.fetch(request('{"action":"list"}'))).status).toBe(200);
  });

  test("setup lock serializes station configuration and fences expired operations", async () => {
    const { registry, setNow } = await fixture();
    const lock = await registry.execute({ action: "acquire-setup", operationId: "operation-a" }) as { expiresAt: number };
    await expect(registry.execute({ action: "acquire-setup", operationId: "operation-b" })).rejects.toMatchObject({ code: "SETUP_LOCKED" });
    await expect(registry.execute({ action: "release-setup", operationId: "operation-b" })).rejects.toMatchObject({ code: "STALE_SETUP_LOCK" });
    setNow(lock.expiresAt);
    await registry.execute({ action: "acquire-setup", operationId: "operation-b" });
    await expect(registry.execute({ action: "release-setup", operationId: "operation-a" })).rejects.toMatchObject({ code: "STALE_SETUP_LOCK" });
    expect(await registry.execute({ action: "release-setup", operationId: "operation-b" })).toEqual({ released: true });
  });
});
