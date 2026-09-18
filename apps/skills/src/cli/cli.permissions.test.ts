import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-cli-permissions-"));
const binary = join(scratch, "skills.js");
beforeAll(() => buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function fixture(permission: boolean | undefined, action: (invoke: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>, calls: string[], profile: string) => Promise<void>) {
  const root = mkdtempSync(join(scratch, "case-")), home = join(root, "home"), data = join(root, "data"), skill = join(data, "installed", "owned-draft");
  mkdirSync(home); mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: owned-draft\ndescription: Owned permission fixture\nkind: instruction\nversion: 1.0.0\n---\n# Owned draft\n");
  writeFileSync(join(skill, "package.json"), JSON.stringify({ name: "owned-draft", version: "1.0.0" }));
  const profile = join(root, "profile.json"); writeFileSync(profile, JSON.stringify({ selections: [] }));
  const originalDraft = readdirSync(skill).sort().map(name => [name, readFileSync(join(skill, name), "utf8")]);
  const token = "permission-cli-fixture", canary = "UNRELATED_PROVIDER_FIELD", calls: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    if (path === "/api/auth/whoami") return Response.json({ user: { id: "user", role: permission === true ? "member" : "owner" }, organization: { id: "workspace" }, apiKey: canary });
    if (path === "/api/v1/capabilities") return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry"],
      ...(permission === undefined ? {} : { scopes: [permission ? "skills:publish" : "skills:read"], permissions: { publish: permission, profilesWrite: permission, apiKey: canary } }), apiKey: canary });
    if (path === "/api/v1/skills/owned-draft") return Response.json({ code: "SKILL_NOT_FOUND" }, { status: 404 });
    if (path === "/api/v1/skills" && request.method === "POST") return Response.json({ version: "1.0.0" }, { status: 201 });
    if (path === "/api/v1/profiles/fleet" && request.method === "PUT") return Response.json({ id: "fleet", revision: "one", selections: [] });
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  } });
  const guard = join(root, "guard.js");
  writeFileSync(guard, `const previous=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==process.env.QA_ORIGIN)throw Error('FIXTURE_NETWORK_REFUSED');return previous(input,init)};`);
  try {
    await action(async args => {
      const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...args], { cwd: root,
        env: { HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"),
          HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_URL: server.url.origin, HASNA_SKILLS_API_KEY_OVERRIDE: token,
          HASNA_STATION: "permissions-fixture", PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, QA_ORIGIN: server.url.origin,
          TMPDIR: root, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try {
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(stdout + stderr).not.toContain(token); expect(stdout + stderr).not.toContain(canary);
        expect(readdirSync(skill).sort().map(name => [name, readFileSync(join(skill, name), "utf8")])).toEqual(originalDraft);
        expect(readdirSync(home)).toEqual([]);
        return { stdout, stderr, code };
      } finally { clearTimeout(deadline); }
    }, calls, profile);
  } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
}

test("built CLI shows denied owner access and refuses both writes without POST or PUT", () => fixture(false, async (invoke, calls, profile) => {
  const identity = await invoke(["auth", "whoami", "--json"]);
  expect(identity).toMatchObject({ code: 0 });
  expect(JSON.parse(identity.stdout)).toMatchObject({ role: "owner", scopes: ["skills:read"], permissions: { publish: false, profilesWrite: false } });
  const capabilities = await invoke(["capabilities", "--json"]);
  expect(capabilities.code).toBe(0);
  expect(JSON.parse(capabilities.stdout)).toMatchObject({ scopes: ["skills:read"], permissions: { publish: false, profilesWrite: false } });
  const human = await invoke(["auth", "whoami"]);
  expect(human.stdout).toContain("Publish: denied"); expect(human.stdout).toContain("Profiles write: denied");
  const pushed = await invoke(["push", "owned-draft", "--json"]);
  expect(pushed.code).toBe(1); expect(JSON.parse(pushed.stdout)).toMatchObject({ code: "SKILLS_PERMISSION_DENIED", permission: "publish", status: 403 });
  expect(pushed.stdout).toContain("This write request was not sent");
  const saved = await invoke(["profiles", "set", "fleet", "--file", profile, "--json"]);
  expect(saved.code).toBe(1); expect(saved.stdout + saved.stderr).toContain("cannot write shared profiles");
  expect(JSON.parse(saved.stdout)).toMatchObject({ code: "SKILLS_PERMISSION_DENIED", permission: "profilesWrite", status: 403 });
  expect(calls.every(call => call.startsWith("GET "))).toBe(true);
}));

for (const permission of [true, undefined]) test(`built CLI preserves ${permission ? "permitted writer" : "older server"} and local dry-run behavior`, () => fixture(permission, async (invoke, calls, profile) => {
  const dry = await invoke(["push", "owned-draft", "--dry-run", "--json"]);
  expect(dry).toMatchObject({ code: 0 }); expect(calls).toEqual([]);
  const identity = await invoke(["auth", "whoami", "--json"]);
  expect(JSON.parse(identity.stdout).permissions).toEqual({ publish: permission ?? null, profilesWrite: permission ?? null });
  expect((await invoke(["push", "owned-draft", "--json"])).code).toBe(0);
  expect((await invoke(["profiles", "set", "fleet", "--file", profile, "--json"])).code).toBe(0);
  expect(calls.filter(call => !call.startsWith("GET "))).toEqual(["POST /api/v1/skills", "PUT /api/v1/profiles/fleet"]);
}));
