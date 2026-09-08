import { afterEach, expect, test } from "bun:test";
import { normalizeSkillsApiOrigin, skillsApiRequestUrl } from "./fleet-credentials.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { buildSkillsApiUrl } from "./remote-registry.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("gateway resource URLs preserve the app prefix and normalize full version bases", () => {
  for (const base of ["https://api.hasna.com/skills", "https://api.hasna.com/skills/", "https://api.hasna.com/skills/v1", "https://api.hasna.com/skills/api/v1"]) {
    expect(normalizeSkillsApiOrigin(base)).toBe("https://api.hasna.com/skills");
    expect(skillsApiRequestUrl(base, "/api/v1/skills?tag=docs")).toBe("https://api.hasna.com/skills/v1/skills?tag=docs");
    expect(buildSkillsApiUrl(base)).toBe("https://api.hasna.com/skills/v1/skills");
  }
});

test("gateway collection URLs normalize without confusing the app prefix", () => {
  for (const base of ["https://api.hasna.com/skills/v1/skills", "https://api.hasna.com/skills/api/v1/skills/"])
    expect(buildSkillsApiUrl(base, "/skills/demo")).toBe("https://api.hasna.com/skills/v1/skills/demo");
});

test("commercial and arbitrary prefixed instances retain their established routes", () => {
  for (const origin of ["https://skills.md", "https://custom.example/prefix", "http://127.0.0.1:3505/prefix", "https://api.hasna.com.example/skills"]) {
    expect(skillsApiRequestUrl(`${origin}/api/v1`, "/api/v1/skills")).toBe(`${origin}/api/v1/skills`);
    expect(skillsApiRequestUrl(origin, "/api/auth/login")).toBe(`${origin}/api/auth/login`);
  }
  expect(normalizeSkillsApiOrigin("https://skills.md/api/v1")).not.toBe(normalizeSkillsApiOrigin("https://api.hasna.com/skills/v1"));
});

test("SDK requests use separately selected URLs and credentials in the same process", async () => {
  const calls: Array<[string, string | null]> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), new Headers(init?.headers).get("authorization")]);
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    return Response.json([]);
  }) as typeof fetch;
  await new RemoteSkillsClient("fixture-internal", "https://api.hasna.com/skills/v1").listSkills();
  await new RemoteSkillsClient("fixture-commercial", "https://skills.md/api/v1").listSkills();
  expect(calls).toEqual([
    ["https://api.hasna.com/skills/v1/skills", "Bearer fixture-internal"],
    ["https://skills.md/api/v1/skills", "Bearer fixture-commercial"],
  ]);
});

test("unsupported internal login is explicit before any credential or account input is sent", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("must not send"); }) as unknown as typeof fetch;
  await expect(new RemoteSkillsAuthClient("https://api.hasna.com/skills").requestCode("fixture@example.test")).rejects.toThrow("no established login contract");
  await expect(new RemoteSkillsAuthClient("https://api.hasna.com/skills/v1").listAccountWorkspaces("fixture@example.test", "123456")).rejects.toThrow("no established login contract");
  expect(calls).toBe(0);
});

test("untrusted URLs and paths cannot change the selected credential authority", () => {
  for (const base of ["https://user:password@api.hasna.com/skills", "https://api.hasna.com/skills?other=1", "https://api.hasna.com/skills#other"]) {
    expect(() => skillsApiRequestUrl(base, "/api/v1/skills")).toThrow();
  }
  for (const route of ["https://elsewhere.example/api/v1/skills", "//elsewhere.example/api/v1/skills", "/api/v1/skills#other", "/api/\\\\elsewhere"]) {
    expect(() => skillsApiRequestUrl("https://api.hasna.com/skills", route)).toThrow();
  }
});
