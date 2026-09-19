import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { withTodosAuth } from "./todos";

const saved = { ...process.env };
const base = "https://todos.example.test/prefix";
const fixture = { initial: "test-key", other: "other", rotated: "rotated" };
let scratchHome: string;

beforeEach(() => {
  // Hermetic: the shared seam's disk tier anchors here, so a station's real
  // ~/.hasna/todos/config/credentials cannot leak into integration fixtures.
  scratchHome = mkdtempSync(join(tmpdir(), "attachments-todos-"));
  for (const name of ["HASNA_TODOS_API_KEY", "TODOS_API_KEY", "HASNA_TODOS_API_URL", "TODOS_API_URL", "HASNA_SESSIONS_API_KEY", "SESSIONS_API_KEY", "HASNA_SESSIONS_API_URL", "SESSIONS_API_URL"]) delete process.env[name];
  process.env.HASNA_HOME = scratchHome;
  process.env.HASNA_TODOS_API_URL = base; process.env.HASNA_TODOS_API_KEY = fixture.initial;
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(scratchHome, { recursive: true, force: true });
});
describe("Todos integration HTTPS boundary", () => {
 test("attaches credentials with redirects disabled", async () => {
   const init = await withTodosAuth(base + "/v1/tasks/id", { method: "POST", headers: { "content-type": "application/json" }, redirect: "follow" });
   expect(new Headers(init.headers).get("x-api-key")).toBe("test-key"); expect(init.redirect).toBe("error");
 });
 for (const url of ["http://localhost:3000", "https://evil.example.test/api", "https://todos.example.test/prefix-other/api", "https://todos.example.test/other"]) test("rejects out-of-bound URL " + url, async () => { await expect(withTodosAuth(url)).rejects.toThrow(); });
 test("missing credential rejects", async () => { delete process.env.HASNA_TODOS_API_KEY; await expect(withTodosAuth(base + "/v1/tasks")).rejects.toThrow(); });
 test("blank canonical key never falls back", async () => { process.env.HASNA_TODOS_API_KEY = " "; process.env.TODOS_API_KEY = fixture.initial; await expect(withTodosAuth(base + "/v1/tasks")).rejects.toThrow(); });
 test("conflicting aliases reject", async () => { process.env.TODOS_API_KEY = fixture.other; await expect(withTodosAuth(base + "/v1/tasks")).rejects.toThrow(); });
 test("matching aliases and same-authority rotation work", async () => {
   process.env.TODOS_API_KEY = fixture.initial;
   expect(new Headers((await withTodosAuth(base + "/v1/tasks")).headers).get("x-api-key")).toBe(fixture.initial);
   process.env.TODOS_API_KEY = fixture.rotated;
   process.env.HASNA_TODOS_API_KEY = fixture.rotated;
   expect(new Headers((await withTodosAuth(base + "/v1/tasks")).headers).get("x-api-key")).toBe(fixture.rotated);
 });
 test("a todos key on disk inside the scratch HASNA_HOME is used, env tier falls below disk", async () => {
   const dir = join(scratchHome, "todos", "config");
   mkdirSync(dir, { recursive: true });
   writeFileSync(join(dir, "credentials"), `HASNA_TODOS_API_KEY=disk-key\n`, { mode: 0o600 });
   expect(new Headers((await withTodosAuth(base + "/v1/tasks")).headers).get("x-api-key")).toBe("disk-key");
 });
});
