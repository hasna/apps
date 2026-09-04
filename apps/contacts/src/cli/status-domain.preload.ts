// Test-only fetch adapter for the `contacts status` CLI tests: never imported
// by a shipped entry point. Mirrors the calendar domain fixture pattern
// (apps/calendar/src/test/domain-fixture.ts) — the spawned CLI child sees a
// bound HTTPS authority served by this shim so status exercises the real
// ApiStore transport without any network.
const originalFetch = globalThis.fetch;
process.env.HASNA_CONTACTS_API_URL = "https://contacts.example.test";
process.env.HASNA_CONTACTS_API_KEY = "status-fixture-key";

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin !== "https://contacts.example.test") return originalFetch(input, init);
  if (req.headers.get("x-api-key") !== "status-fixture-key") {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  if (url.pathname.includes("/companies")) {
    return Response.json({ companies: [{ id: "company-1", name: "Acme" }], count: 1 });
  }
  return Response.json({ contacts: [{ id: "contact-1", display_name: "Ada" }], count: 2 });
}) as typeof fetch;
