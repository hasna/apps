// Explicit test-only fetch adapter: never imported by a shipped entry point.
// Keeps the real HTTPS client and /v1 routing in CLI/MCP regression tests while
// using temporary/in-memory SQLite solely as the server fixture.
import { LocalStore } from "../store/local.js";
import { handleV1Request } from "../server/v1.js";
export function installDomainFixture(): () => void {
  const original = globalThis.fetch;
  const oldUrl = process.env.HASNA_CALENDAR_API_URL;
  const oldKey = process.env.HASNA_CALENDAR_API_KEY;
  process.env.HASNA_CALENDAR_API_URL = "https://calendar.example.test";
  process.env.HASNA_CALENDAR_API_KEY = "fixture-key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== "https://calendar.example.test") return original(input, init);
    if (req.headers.get("x-api-key") !== "fixture-key" || init?.redirect !== "error") throw new Error("Fixture requires bound HTTPS auth.");
    return await handleV1Request(req, url, {
      getCloudStore: () => new LocalStore(),
      getCloudVerifier: () => ({ authenticate: async () => ({ ok: true }) }),
    } as never) ?? new Response(null, { status: 404 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
    if (oldUrl === undefined) delete process.env.HASNA_CALENDAR_API_URL; else process.env.HASNA_CALENDAR_API_URL = oldUrl;
    if (oldKey === undefined) delete process.env.HASNA_CALENDAR_API_KEY; else process.env.HASNA_CALENDAR_API_KEY = oldKey;
  };
}
