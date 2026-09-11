// Isolated read-only API fixture for real CLI subprocess tests. SQLite belongs
// to this fixture server only; tested clients receive saved HTTP credentials.
import { LocalStore } from "../db/local-store.js";
const store = new LocalStore();
await store.getDomainStats();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  if (req.headers.get("authorization") !== "Bearer domains-fixture-key" && req.headers.get("x-api-key") !== "domains-fixture-key") return Response.json({error:"unauthorized"}, {status:401});
  const url = new URL(req.url);
  if (req.method !== "GET") return Response.json({error:"read only"}, {status:405});
  if (url.pathname === "/v1/domains/stats") return Response.json(await store.getDomainStats());
  if (url.pathname === "/v1/domains") {
    const domains = await store.listDomains({limit: Number(url.searchParams.get("limit") ?? 100), offset: Number(url.searchParams.get("offset") ?? 0), ...(url.searchParams.has("search") ? {search:url.searchParams.get("search")!} : {})});
    return Response.json({domains, count:domains.length});
  }
  const match = url.pathname.match(/^\/v1\/domains\/([^/]+)(?:\/(dns|offers|emails))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]!);
    if (match[2] === "dns") return Response.json({records:await store.listDnsRecords(id)});
    if (match[2] === "offers") return Response.json({offers:await store.listDomainOffers(id)});
    if (match[2] === "emails") return Response.json({emails:await store.listDomainEmailLinks(id)});
    const domain = await store.getDomain(id);
    return domain ? Response.json(domain) : Response.json({error:"not found"}, {status:404});
  }
  return Response.json({error:"not found"}, {status:404});
}});
console.log(JSON.stringify({port:server.port}));
