import { describe, expect, test } from "bun:test";
import { createCloudflarePlan, generateWorkerScript } from "./cloudflare.js";
import { buildDomainsArgs } from "./domains-cli.js";

describe("integration helpers", () => {
  test("creates Cloudflare setup plans without secrets", () => {
    const plan = createCloudflarePlan({
      hostname: "has.na",
      target: "shortlinks.example.com",
      origin: "https://shortlinks.example.com",
      workerName: "shortlinks",
    });

    expect(plan.dnsRecord).toEqual({
      type: "CNAME",
      name: "has.na",
      content: "shortlinks.example.com",
      proxied: true,
    });
    expect(plan.wranglerCommand).toContain("wrangler deploy");
  });

  test("generates a worker that forwards host context to the origin", () => {
    const script = generateWorkerScript();
    expect(script).toContain("SHORTLINKS_ORIGIN");
    expect(script).toContain("ATTACHMENTS_ORIGIN");
    expect(script).toContain("SHORTLINKS_RESERVED_PATH_PREFIXES");
    expect(script).toContain("SHORTLINKS_ADMIN_PATH_PREFIXES");
    expect(script).toContain("\"a,api\"");
    expect(script).toContain("\"/api,/_shortlinks/api\"");
    expect(script).toContain("Reserved path prefix");
    expect(script).toContain("Not found");
    expect(script).toContain("x-forwarded-host");
    expect(script).toContain("return proxyTo(env.ATTACHMENTS_ORIGIN");
    expect(script).toContain("redirect: \"manual\"");
  });

  test("generated worker does not proxy admin API prefixes to the origin", async () => {
    const script = generateWorkerScript();
    const worker = new Function(script.replace("export default", "return"))() as {
      fetch(request: Request, env: Record<string, string | undefined>): Promise<Response>;
    };
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response("proxied", { status: 204 }));
    }) as typeof fetch;

    try {
      const env = { SHORTLINKS_ORIGIN: "https://origin.example" };
      const defaultApi = await worker.fetch(new Request("https://go.example/api/links"), env);
      const privateApi = await worker.fetch(new Request("https://go.example/_shortlinks/api/links"), env);
      const redirect = await worker.fetch(new Request("https://go.example/docs?x=1"), env);

      expect(defaultApi.status).toBe(404);
      expect(privateApi.status).toBe(404);
      expect(redirect.status).toBe(204);
      expect(calls).toEqual(["https://origin.example/docs?x=1"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses the @hasna/domains CLI rather than connect packages", () => {
    expect(buildDomainsArgs("check", "has.na")).toEqual(["domain", "check", "has.na"]);
    expect(buildDomainsArgs("buy", "has.na")).toEqual(["domain", "buy", "has.na"]);
    expect(buildDomainsArgs("setup", "has.na")).toEqual(["domain", "setup", "has.na"]);
  });
});
