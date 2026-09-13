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
        selections: [entry],
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
    for (mode of ["moved-tenant", "bad-digest", "moved-authority"])
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
