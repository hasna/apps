import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { withTodosAuth } from "./todos";
const saved = { ...process.env };
const base = "https://todos.example.test/prefix";
beforeEach(() => {
 for (const name of ["HASNA_TODOS_API_KEY", "TODOS_API_KEY", "HASNA_TODOS_API_URL", "TODOS_API_URL"]) delete process.env[name];
 process.env.HASNA_TODOS_API_URL = base; process.env.HASNA_TODOS_API_KEY = "test-key";
});
afterEach(() => { process.env = { ...saved }; });
describe("Todos integration HTTPS boundary", () => {
 test("attaches credentials with redirects disabled", () => {
   const init = withTodosAuth(base + "/api/tasks/id", { method: "POST", headers: { "content-type": "application/json" }, redirect: "follow" });
   expect(new Headers(init.headers).get("x-api-key")).toBe("test-key"); expect(init.redirect).toBe("error");
 });
 for (const url of ["http://localhost:3000", "https://evil.example.test/api", "https://todos.example.test/prefix-other/api", "https://todos.example.test/other"]) test("rejects out-of-bound URL " + url, () => { expect(() => withTodosAuth(url)).toThrow(); });
 test("missing credential rejects", () => { delete process.env.HASNA_TODOS_API_KEY; expect(() => withTodosAuth(base + "/api/tasks")).toThrow(); });
 test("blank canonical key never falls back", () => { process.env.HASNA_TODOS_API_KEY = " "; process.env.TODOS_API_KEY = "test-key"; expect(() => withTodosAuth(base + "/api/tasks")).toThrow(); });
 test("conflicting aliases reject", () => { process.env.TODOS_API_KEY = "other"; expect(() => withTodosAuth(base + "/api/tasks")).toThrow(); });
 test("matching aliases and same-authority rotation work", () => { process.env.TODOS_API_KEY = "test-key"; expect(new Headers(withTodosAuth(base + "/api/tasks").headers).get("x-api-key")).toBe("test-key"); process.env.TODOS_API_KEY = process.env.HASNA_TODOS_API_KEY = "rotated"; expect(new Headers(withTodosAuth(base + "/api/tasks").headers).get("x-api-key")).toBe("rotated"); });
});
