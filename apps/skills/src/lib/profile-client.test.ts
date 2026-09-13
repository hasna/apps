import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import { HttpProfileClient } from "./profile-client.js";

useDefaultTestTimeout();
test("profile client binds authority and snapshot references and refuses malformed success", async () => {
  let mode = "valid";
  let authority = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      expect(request.headers.get("user-agent")).toStartWith("hasna-skills/");
      expect(request.headers.get("authorization")).toBe(
        "Bearer fixture-profile-client",
      );
      const entry = {
        slug: "release-notes",
        version: "1.0.0",
        bundleDigest: `sha256:${"a".repeat(64)}`,
        authority,
        workspaceId: "org_profile",
        profileRevision: "revision-one",
        triggers: { keywords: ["release"] },
        aliases: mode === "bad-alias" ? ["../outside"] : mode === "self-alias" ? ["release-notes"] : ["legacy-release"],
      };
      if (mode === "moved-tenant") entry.workspaceId = "org_elsewhere";
      if (mode === "bad-digest") entry.bundleDigest = "sha256:wrong";
      return Response.json({
        profileId: "default",
        workspaceId: "org_profile",
        profileRevision: "revision-one",
        authority:
          mode === "moved-authority"
            ? "https://other.example.test/api/v1"
            : authority,
        selections: mode === "shared-alias" ? [entry, { ...entry, slug: "other-notes" }] : [entry],
      });
    },
  });
  authority = `${server.url.origin}/api/v1`;
  try {
    const client = new HttpProfileClient(
      "fixture-profile-client",
      server.url.origin,
    );
    expect(
      (await client.resolveProfile("default")).selections[0]?.bundleDigest,
    ).toBe(`sha256:${"a".repeat(64)}`);
    expect((await client.resolveProfile("default")).selections[0]?.aliases).toEqual(["legacy-release"]);
    for (mode of ["moved-tenant", "bad-digest", "moved-authority", "bad-alias", "self-alias", "shared-alias"])
      await expect(client.resolveProfile("default")).rejects.toThrow(
        "invalid profile response",
      );
    await expect(client.resolveProfile("../elsewhere")).rejects.toThrow(
      "Invalid selection profile id",
    );
  } finally {
    server.stop(true);
  }
});

test("station receipt must preserve the complete submitted canonical selection", async () => {
  let mode = "valid";
  const selection = { slug: "review-code", version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}`, aliases: ["legacy-review"], triggers: { keywords: ["review"], always: false } };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = await request.json() as any;
    const entry = structuredClone(selection);
    if (mode === "stripped-alias") delete (entry as any).aliases;
    if (mode === "changed-digest") entry.bundleDigest = `sha256:${"b".repeat(64)}`;
    if (mode === "changed-version") entry.version = "2.0.0";
    if (mode === "changed-trigger") entry.triggers.always = true;
    return Response.json({ stationId: "station-fixture", workspaceId: "org_profile", actorId: "user_profile", appliedAt: new Date().toISOString(), ...input, selections: mode === "missing-selection" ? [] : [entry] });
  } });
  try {
    const client = new HttpProfileClient("fixture-profile-client", server.url.origin);
    const input = { profileId: "engineering", profileRevision: "revision-one", selections: [selection] };
    expect((await client.recordStation("station-fixture", input)).selections).toEqual([selection]);
    for (mode of ["stripped-alias", "changed-digest", "changed-version", "changed-trigger", "missing-selection"]) await expect(client.recordStation("station-fixture", input)).rejects.toThrow("invalid profile response");
  } finally { server.stop(true); }
});
