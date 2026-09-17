import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSkillsFetchHandler } from "./app.js";
import { publicPrincipal } from "./auth.js";
import { resolveStoreBackends, storeBackendNotices } from "./store-fixtures.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const backends = await resolveStoreBackends();
for (const notice of storeBackendNotices())
  console.log(`[execution-grants] ${notice}`);
for (const backend of backends) {
  test(`execution grants preserve reviewed authority across profile updates and revoke with history (${backend.name})`, async () => {
    const owner = publicPrincipal({
      orgId: "org_grants",
      orgSlug: "grants",
      userId: "owner_grants",
      apiKeyId: "owner_grants_key",
    });
    const fixture = await backend.create([
      { token: "fixture-grants-owner", principal: owner },
      {
        token: "fixture-grants-reader",
        principal: {
          ...owner,
          apiKeyId: "reader_grants_key",
          scopes: ["skills:read"],
        },
      },
      {
        token: "fixture-grants-publisher",
        principal: {
          ...owner,
          apiKeyId: "publisher_grants_key",
          scopes: ["skills:*"],
        },
      },
      {
        token: "fixture-grants-colleague",
        principal: {
          ...owner,
          userId: "colleague_grants",
          apiKeyId: "colleague_grants_key",
          email: "colleague@example.test",
          scopes: ["skills:read"],
        },
      },
      {
        token: "fixture-grants-member",
        principal: {
          ...owner,
          userId: "member_grants",
          email: "member@example.test",
          role: "member",
          apiKeyId: "member_grants_key",
          scopes: ["*"],
        },
      },
      {
        token: "fixture-grants-outsider",
        principal: {
          orgId: "org_grants_other",
          orgSlug: "grants-other",
          userId: "outside_grants",
          apiKeyId: "outside_grants_key",
          email: "outside@example.test",
        },
      },
    ]);
    const root = mkdtempSync(join(tmpdir(), "skills-grant-source-"));
    try {
      const skillMd =
        "---\nname: grant-fixture\ndescription: Synthetic grant fixture\nkind: executable\n---\nSynthetic fixture only.\n";
      writeFileSync(join(root, "SKILL.md"), skillMd);
      writeFileSync(
        join(root, "skill.json"),
        JSON.stringify({
          name: "grant-fixture",
          version: "1.0.0",
          kind: "executable",
          runtime: {
            runtime: "bun",
            entrypoint: "run.ts",
            env: ["PROVIDER_TOKEN"],
            timeout: 5,
            sandbox: "full",
            needs_network: true,
          },
        })
      );
      writeFileSync(join(root, "run.ts"), 'console.log("synthetic fixture");');
      const bundle = packSkillBundle(root);
      await fixture.store.publishSkill({
        principal: owner,
        slug: "grant-fixture",
        displayName: "Grant fixture",
        description: "Synthetic",
        category: "Development Tools",
        tags: [],
        source: "custom",
        kind: "executable",
        version: "1.0.0",
        skillMd,
        bundle: {
          sha256: bundle.sha256,
          byteSize: bundle.bytes.length,
          contentType: "application/gzip",
          storageKind: "db",
          bytes: bundle.bytes,
        },
      });
      const selection = {
        slug: "grant-fixture",
        version: "1.0.0",
        bundleDigest: `sha256:${bundle.sha256}`,
      };
      const firstProfile = await fixture.store.selectionStore!.saveProfile(
        owner,
        "engineering",
        [selection],
        null
      );
      const handler = await createSkillsFetchHandler({
        store: fixture.store,
        governanceStore: fixture.governanceStore,
        runtime: null,
        config: {
          allowEphemeralStore: fixture.allowEphemeralStore,
          publicBaseUrl: "https://skills.example.test",
        },
      });
      async function call(
        path: string,
        method = "GET",
        input?: unknown,
        headers: Record<string, string> = {},
        token = "fixture-grants-owner"
      ) {
        const r = await handler(
          new Request(`https://skills.example.test/v1/${path}`, {
            method,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              ...headers,
            },
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
          })
        );
        return {
          status: r.status,
          body: await r.json(),
          etag: r.headers.get("etag"),
          cache: r.headers.get("cache-control"),
        };
      }
      const grant = {
        id: "provider-read",
        target: "local",
        selection,
        actors: [owner.userId],
        consumers: [
          {
            stationId: "station-fixture",
            workspaceDirectory: "/workspace/reviewed",
            includeDescendants: true,
          },
        ],
        secretsAuthority: "https://vault.example.test/v1",
        bindings: { PROVIDER_TOKEN: "demo/provider/key" },
      };
      const input = { grants: [grant] };
      expect((await call("capabilities")).body).toMatchObject({
        executionGrants: true,
        permissions: { executionGrantsWrite: true },
      });
      expect(
        (await call("execution-grants/engineering", "PUT", input)).status
      ).toBe(428);
      for (const token of [
        "fixture-grants-reader",
        "fixture-grants-publisher",
        "fixture-grants-member",
      ]) {
        expect(
          (
            await call(
              "execution-grants/engineering",
              "PUT",
              input,
              { "if-none-match": "*" },
              token
            )
          ).status
        ).toBe(403);
      }
      for (const token of [
        "fixture-grants-reader",
        "fixture-grants-publisher",
      ]) {
        expect(
          (
            await call(
              "execution-grants/engineering",
              "GET",
              undefined,
              {},
              token
            )
          ).status
        ).toBe(403);
        expect(
          (await call("capabilities", "GET", undefined, {}, token)).body
            .permissions.executionGrantsWrite
        ).toBe(false);
      }
      for (const invalid of [
        { ...grant, target: "cloud" },
        { ...grant, actors: ["*"] },
        { ...grant, bindings: { NODE_OPTIONS: "demo/provider/key" } },
        {
          ...grant,
          consumers: [
            {
              stationId: "station-fixture",
              workspaceDirectory: "/workspace/reviewed/../elsewhere",
            },
          ],
        },
      ]) {
        expect(
          (
            await call(
              "execution-grants/engineering",
              "PUT",
              { grants: [invalid] },
              { "if-none-match": "*" }
            )
          ).status
        ).toBe(400);
      }
      expect(
        (
          await call(
            "execution-grants/engineering",
            "PUT",
            {
              grants: [
                {
                  ...grant,
                  bindings: { UNDECLARED_TOKEN: "demo/provider/key" },
                },
              ],
            },
            { "if-none-match": "*" }
          )
        ).status
      ).toBe(400);
      const created = await call("execution-grants/engineering", "PUT", input, {
        "if-none-match": "*",
      });
      expect(created.status).toBe(201);
      expect(created.body.grants).toEqual([grant]);
      expect(created.body.previousRevision).toBeNull();
      expect(
        (
          await call(
            "execution-grants/engineering",
            "GET",
            undefined,
            {},
            "fixture-grants-outsider"
          )
        ).status
      ).toBe(404);
      const request = {
        selection: {
          ...selection,
          authority: "https://skills.example.test/api/v1",
          workspaceId: owner.orgId,
          profileId: "engineering",
          profileRevision: firstProfile!.revision,
        },
        consumer: {
          stationId: "station-fixture",
          workspaceDirectory: "/workspace/reviewed/project",
        },
      };
      const resolve = (v: unknown = request, token = "fixture-grants-reader") =>
        call("execution-grants/engineering/resolve", "POST", v, {}, token);
      const admitted = await resolve();
      expect(admitted.status).toBe(200);
      expect(admitted.cache).toBe("no-store");
      expect(admitted.body).toMatchObject({
        policyRevision: created.body.revision,
        grantId: grant.id,
        bindings: {
          schema: "hasna.skills-secret-bindings.v1",
          selection: request.selection,
          consumer: request.consumer,
          secretsAuthority: grant.secretsAuthority,
          bindings: grant.bindings,
        },
      });
      expect((await resolve(request, "fixture-grants-colleague")).status).toBe(
        403
      );
      expect(
        (
          await resolve({
            ...request,
            consumer: { ...request.consumer, stationId: "another-station" },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await resolve({
            ...request,
            consumer: {
              ...request.consumer,
              workspaceDirectory: "/workspace/reviewed-sibling",
            },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await resolve({
            ...request,
            selection: {
              ...request.selection,
              bundleDigest: `sha256:${"0".repeat(64)}`,
            },
          })
        ).status
      ).toBe(409);
      for (const delta of [
        { authority: "https://other.example.test/api/v1" },
        { workspaceId: "org_grants_other" },
        { profileId: "another-profile" },
      ]) {
        expect(
          (
            await resolve({
              ...request,
              selection: { ...request.selection, ...delta },
            })
          ).status
        ).toBe(403);
      }
      const updated = await fixture.store.selectionStore!.saveProfile(
        owner,
        "engineering",
        [{ ...selection, triggers: { keywords: ["unrelated profile edit"] } }],
        firstProfile!.revision
      );
      expect((await resolve()).status).toBe(409);
      const currentRequest = {
        ...request,
        selection: { ...request.selection, profileRevision: updated!.revision },
      };
      const stillAuthorized = await resolve(currentRequest);
      expect(stillAuthorized.status).toBe(200);
      expect(stillAuthorized.body.policyRevision).toBe(created.body.revision);
      const changes = await Promise.all([
        call(
          "execution-grants/engineering",
          "PUT",
          { grants: [] },
          { "if-match": created.etag! }
        ),
        call(
          "execution-grants/engineering",
          "PUT",
          { grants: [] },
          { "if-match": created.etag! }
        ),
      ]);
      expect(changes.map((c) => c.status).sort()).toEqual([200, 409]);
      const revoked = changes.find((c) => c.status === 200)!;
      expect(revoked.body.previousRevision).toBe(created.body.revision);
      expect((await resolve(currentRequest)).status).toBe(403);
      const historical = await call(
        `execution-grants/engineering/versions/${created.body.revision}`
      );
      expect(historical.status).toBe(200);
      expect(historical.body).toEqual(created.body);
      expect(
        (
          await call(
            `execution-grants/engineering/versions/${created.body.revision}`,
            "GET",
            undefined,
            {},
            "fixture-grants-outsider"
          )
        ).status
      ).toBe(404);
      let policyRevision = revoked.body.revision;
      for (const grants of [
        [{ ...grant, expiresAt: "2000-01-01T00:00:00.000Z" }],
        [grant, { ...grant, id: "ambiguous-second" }],
        [
          {
            ...grant,
            consumers: [
              {
                stationId: "station-fixture",
                workspaceDirectory: "/workspace/reviewed",
              },
            ],
          },
        ],
      ]) {
        const saved = await call(
          "execution-grants/engineering",
          "PUT",
          { grants },
          { "if-match": `"${policyRevision}"` }
        );
        expect(saved.status).toBe(200);
        policyRevision = saved.body.revision;
        expect((await resolve(currentRequest)).status).toBe(403);
      }
      // A selected bundle cannot receive a grant after it has been removed from the profile.
      const removed = await fixture.store.selectionStore!.saveProfile(
        owner,
        "engineering",
        [],
        updated!.revision
      );
      expect(
        (
          await resolve({
            ...currentRequest,
            selection: {
              ...currentRequest.selection,
              profileRevision: removed!.revision,
            },
          })
        ).status
      ).toBe(409);
      expect(
        (
          await call("execution-grants/engineering", "PUT", input, {
            "if-match": `"${policyRevision}"`,
          })
        ).status
      ).toBe(409);
      await handler.close();
    } finally {
      await fixture.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
