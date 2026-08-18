import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { withTodosAuth } from "./todos";

function clearTodosEnv() {
  delete process.env.HASNA_TODOS_API_KEY;
  delete process.env.TODOS_API_KEY;
  delete process.env.HASNA_TODOS_API_URL;
  delete process.env.TODOS_API_URL;
  // The contracts credential chain consults the fleet app-config files under
  // HOME before the deprecated legacy env vars, so a local test must kill the
  // disk tier or a real fleet todos key overrides the fixture.
  process.env.HOME = "";
}

beforeEach(clearTodosEnv);
afterEach(clearTodosEnv);

describe("withTodosAuth", () => {
  it("returns the original request init when no API key is configured", () => {
    const init = { method: "POST" };

    expect(withTodosAuth("http://localhost:3000/api/tasks/TASK-001", init)).toBe(init);
    expect(withTodosAuth()).toBeUndefined();
  });

  it("uses TODOS_API_KEY as an x-api-key header for the default todos origin", () => {
    process.env.TODOS_API_KEY = "tf";

    const init = withTodosAuth("http://localhost:3000/api/tasks/TASK-001", {
      headers: { "Content-Type": "application/json" },
    });
    const headers = new Headers(init?.headers);

    expect(headers.get("x-api-key")).toBe("tf");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("prefers a non-empty HASNA_TODOS_API_KEY", () => {
    process.env.HASNA_TODOS_API_KEY = "k1";
    process.env.TODOS_API_KEY = "k2";

    const headers = new Headers(withTodosAuth("http://localhost:3000/api/tasks/TASK-001")?.headers);

    expect(headers.get("x-api-key")).toBe("k1");
  });

  it("falls back when HASNA_TODOS_API_KEY is empty", () => {
    process.env.HASNA_TODOS_API_KEY = "";
    process.env.TODOS_API_KEY = "k2";

    const headers = new Headers(withTodosAuth("http://localhost:3000/api/tasks/TASK-001")?.headers);

    expect(headers.get("x-api-key")).toBe("k2");
  });

  it("does not forward the API key to an arbitrary override origin", () => {
    process.env.HASNA_TODOS_API_KEY = "k1";
    const init = { method: "GET" };

    expect(withTodosAuth("https://example.invalid/api/tasks/TASK-001", init)).toBe(init);
  });

  it("allows a remote origin only when it is explicitly configured", () => {
    process.env.HASNA_TODOS_API_URL = "https://todos.example.com";
    process.env.HASNA_TODOS_API_KEY = "k1";

    const headers = new Headers(withTodosAuth("https://todos.example.com/api/tasks/TASK-001")?.headers);

    expect(headers.get("x-api-key")).toBe("k1");
  });
});
