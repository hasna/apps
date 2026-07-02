import { describe, expect, it } from "bun:test";
import { handleMcpHttpRequest } from "./http.js";
import { buildServer } from "./server.js";

describe("MCP startup contract", () => {
  it("builds the server and exposes HTTP health", async () => {
    expect(buildServer()).toBeTruthy();
    const response = await handleMcpHttpRequest(new Request("http://127.0.0.1:8874/health"));
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("ok");
  });
});
