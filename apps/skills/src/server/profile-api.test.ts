import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import { createSkillsFetchHandler } from "./app.js";
import { resolveStoreBackends, storeBackendNotices } from "./store-fixtures.js";
import { publicPrincipal } from "./auth.js";
import { ownBytes, sha256Hex } from "../lib/skill-bundle.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSkillsStore } from "./sqlite-store.js";

useDefaultTestTimeout();
const backends = await resolveStoreBackends();
for (const notice of storeBackendNotices())
  console.log(`[profile-api] ${notice}`);
for (const backend of backends) {
  test(`profiles resolve exact versions with CAS and stable station receipts (${backend.name})`, async () => {
    const owner = publicPrincipal({
      orgId: "org_profile",
      orgSlug: "profile",
      userId: "user_profile",
      apiKeyId: "key_profile",
    });
    const rotated = { ...owner, apiKeyId: "key_rotated" };
    const colleague = {
      ...owner,
      userId: "user_other",
      apiKeyId: "key_colleague",
      email: "other@example.test",
    };
    const outsider = publicPrincipal({
      orgId: "org_other",
      orgSlug: "other",
      userId: "user_outside",
      apiKeyId: "key_outside",
      email: "outside@example.test",
    });
    const fixture = await backend.create([
      { token: "fixture-owner", principal: owner },
      { token: "fixture-rotated", principal: rotated },
      { token: "fixture-colleague", principal: colleague },
      { token: "fixture-outsider", principal: outsider },
    ]);
    try {
      const bytes = ownBytes(
          new TextEncoder().encode("reviewed immutable fixture"),
        ),
        digest = sha256Hex(bytes);
      await fixture.store.publishSkill({
        principal: owner,
        slug: "release-notes",
        displayName: "Release notes",
        description: "Fixture",
        category: "Development Tools",
        tags: [],
        source: "custom",
        kind: "instruction",
        version: "1.0.0",
        skillMd: "# Fixture",
        bundle: {
          sha256: digest,
          byteSize: bytes.length,
          contentType: "application/gzip",
          storageKind: "db",
          bytes,
        },
      });
      const handler = await createSkillsFetchHandler({
        store: fixture.store,
        governanceStore: fixture.governanceStore,
        config: {
          allowEphemeralStore: fixture.allowEphemeralStore,
          publicBaseUrl: "https://skills.example.test",
        },
      });
      const call = async (
        path: string,
        method = "GET",
        input?: unknown,
        headers: Record<string, string> = {},
        token = "fixture-owner",
      ) => {
        const response = await handler(
          new Request(`https://skills.example.test/v1/${path}`, {
            method,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              ...headers,
            },
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
          }),
        );
        return {
          status: response.status,
          body: await response.json(),
          etag: response.headers.get("etag"),
        };
      };
      const selection = {
        slug: "release-notes",
        version: "1.0.0",
        bundleDigest: `sha256:${digest}`,
        triggers: { keywords: ["release"], always: false },
      };
      expect((await call("capabilities")).body).toMatchObject({
        profileResolution: true,
        stationState: true,
        incrementalSync: false,
      });
      expect(
        (await call("profiles/default", "PUT", { selections: [selection] }))
          .status,
      ).toBe(428);
      expect(
        (
          await call(
            "profiles/default",
            "PUT",
            {
              selections: [
                { ...selection, bundleDigest: `sha256:${"0".repeat(64)}` },
              ],
            },
            { "if-none-match": "*" },
          )
        ).status,
      ).toBe(409);
      const created = await call(
        "profiles/default",
        "PUT",
        { selections: [selection] },
        { "if-none-match": "*" },
      );
      expect(created.status).toBe(201);
      expect(created.body.workspaceId).toBe(owner.orgId);
      expect(
        (
          await call(
            "profiles/default",
            "PUT",
            { selections: [selection] },
            { "if-none-match": "*" },
          )
        ).status,
      ).toBe(409);
      const resolved = await call("profiles/default/resolve");
      expect(resolved.body).toMatchObject({
        profileId: "default",
        workspaceId: owner.orgId,
        authority: "https://skills.example.test/api/v1",
        profileRevision: created.body.revision,
        selections: [
          {
            ...selection,
            authority: "https://skills.example.test/api/v1",
            workspaceId: owner.orgId,
            profileRevision: created.body.revision,
          },
        ],
      });
      expect(
        (
          await call(
            "profiles/default/resolve",
            "GET",
            undefined,
            {},
            "fixture-outsider",
          )
        ).status,
      ).toBe(404);
      const receipt = {
        profileId: "default",
        profileRevision: created.body.revision,
        selections: [selection],
      };
      expect(
        (
          await call("stations/station01/state", "PUT", {
            ...receipt,
            selections: [],
          })
        ).status,
      ).toBe(409);
      expect(
        (await call("stations/station01/state", "PUT", receipt)).body,
      ).toMatchObject({
        stationId: "station01",
        actorId: owner.userId,
        workspaceId: owner.orgId,
        profileRevision: created.body.revision,
      });
      expect(
        (
          await call(
            "stations/station01/state",
            "GET",
            undefined,
            {},
            "fixture-rotated",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            "stations/station01/state",
            "GET",
            undefined,
            {},
            "fixture-colleague",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            "stations/station01/state",
            "GET",
            undefined,
            {},
            "fixture-outsider",
          )
        ).status,
      ).toBe(404);
      const updates = await Promise.all([
        call(
          "profiles/default",
          "PUT",
          { selections: [selection] },
          { "if-match": created.etag! },
        ),
        call(
          "profiles/default",
          "PUT",
          { selections: [] },
          { "if-match": created.etag! },
        ),
      ]);
      expect(updates.map((row) => row.status).sort()).toEqual([200, 409]);
      expect(
        (await call("stations/station01/state", "PUT", receipt)).status,
      ).toBe(409);
      const latest = await call("profiles/default");
      const restored = await call(
        "profiles/default",
        "PUT",
        { selections: [selection] },
        { "if-match": latest.etag! },
      );
      expect(restored.status).toBe(200);
      await fixture.store.deleteSkill(owner, "release-notes", 60_000);
      expect((await call("profiles/default/resolve")).status).toBe(410);
      expect(
        (
          await call(
            "profiles/default",
            "PUT",
            { selections: [selection] },
            { "if-match": restored.etag! },
          )
        ).status,
      ).toBe(410);
    } finally {
      await fixture.close();
    }
  });
  test(`read-only keys cannot publish, delete, or change selections (${backend.name})`, async () => {
    const fixture = await backend.create([
      {
        token: "fixture-reader",
        principal: { scopes: ["skills:read"], role: "owner" },
      },
    ]);
    try {
      const handler = await createSkillsFetchHandler({
        store: fixture.store,
        governanceStore: fixture.governanceStore,
        config: { allowEphemeralStore: fixture.allowEphemeralStore },
      });
      const capabilities = await handler(
        new Request("https://skills.example.test/v1/capabilities", {
          headers: { authorization: "Bearer fixture-reader" },
        }),
      );
      expect(await capabilities.json()).toMatchObject({
        scopes: ["skills:read"],
        permissions: {
          read: true,
          publish: false,
          profilesWrite: false,
          stationStateWrite: false,
          cloudSubmit: false,
        },
      });
      for (const [path, method] of [
        ["skills", "POST"],
        ["skills/example", "DELETE"],
        ["profiles/default", "PUT"],
        ["pins/example", "PUT"],
      ]) {
        const response = await handler(
          new Request(`https://skills.example.test/v1/${path}`, {
            method,
            headers: {
              authorization: "Bearer fixture-reader",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              slug: "example",
              kind: "instruction",
              description: "fixture",
              skillMd: "# Fixture",
            }),
          }),
        );
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe("INSUFFICIENT_SCOPE");
      }
    } finally {
      await fixture.close();
    }
  });
}

test("profile revision and station receipt survive reopening SQLite", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-profile-durable-")),
    path = join(root, "server.db");
  let store = new SqliteSkillsStore(path);
  try {
    await store.ensureBootstrapApiKey("fixture-durability");
    const principal = publicPrincipal(),
      profile = await store.selectionStore.saveProfile(
        principal,
        "default",
        [],
        null,
      );
    const receipt = await store.selectionStore.saveStationState(
      principal,
      "station01",
      {
        profileId: "default",
        profileRevision: profile!.revision,
        selections: [],
      },
    );
    await store.close();
    store = new SqliteSkillsStore(path);
    expect(await store.selectionStore.getProfile(principal, "default")).toEqual(
      profile,
    );
    expect(
      await store.selectionStore.getStationState(principal, "station01"),
    ).toEqual(receipt);
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
