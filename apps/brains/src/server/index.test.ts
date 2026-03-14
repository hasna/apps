import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createServerFetchHandler } from "./index.js";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../package.json"), "utf-8")
) as { version: string };

describe("brains server", () => {
  test("reports the current package version on /health", async () => {
    const handler = createServerFetchHandler();
    const response = handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "brains",
      version: packageJson.version,
    });
  });

  test("returns 404 for unknown routes", async () => {
    const handler = createServerFetchHandler();
    const response = handler(new Request("http://localhost/unknown"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not found" });
  });
});
