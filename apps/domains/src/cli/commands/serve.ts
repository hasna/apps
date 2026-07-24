import type { Command } from "commander";
import {
  createDomain, getDomain, listDomains, updateDomain, deleteDomain,
  listDnsRecords, createDnsRecord,
} from "../../db/domains.js";
import { getPackageVersion } from "../../lib/version.js";

export function registerServeCommand(program: Command): void {
  const packageVersion = getPackageVersion();

  program
    .command("serve")
    .description("Start HTTP API server")
    .option("--port <n>", "Port to listen on", "3000")
    .option("--host <h>", "Host to bind to", "127.0.0.1")
    .action(async (opts: { port: string; host: string }) => {
      const port = parseInt(opts.port);

      const server = Bun.serve({
        port,
        hostname: opts.host,
        async fetch(req) {
          const url = new URL(req.url);
          const path = url.pathname;
          const method = req.method;

          const json = (data: unknown, status = 200) =>
            new Response(JSON.stringify(data), {
              status,
              headers: { "Content-Type": "application/json" },
            });

          const notFound = () => json({ error: "Not found" }, 404);

          try {
            // GET /health
            if (method === "GET" && path === "/health") {
              return json({ status: "ok", version: packageVersion });
            }

            // GET /domains
            if (method === "GET" && path === "/domains") {
              const search = url.searchParams.get("search") ?? undefined;
              const status = url.searchParams.get("status") as "active" | "expired" | undefined;
              const domains = await listDomains({ search, status });
              return json({ domains, count: domains.length });
            }

            // POST /domains
            if (method === "POST" && path === "/domains") {
              const body = (await req.json()) as Parameters<typeof createDomain>[0];
              const domain = await createDomain(body);
              return json(domain, 201);
            }

            // GET /domains/:id
            const domainMatch = path.match(/^\/domains\/([^/]+)$/);
            if (domainMatch) {
              const id = domainMatch[1]!;
              if (method === "GET") {
                const domain = await getDomain(id);
                return domain ? json(domain) : notFound();
              }
              if (method === "PUT" || method === "PATCH") {
                const body = (await req.json()) as Parameters<typeof updateDomain>[1];
                const domain = await updateDomain(id, body);
                return domain ? json(domain) : notFound();
              }
              if (method === "DELETE") {
                const deleted = await deleteDomain(id);
                return json({ id, deleted });
              }
            }

            // GET /domains/:id/dns
            const dnsMatch = path.match(/^\/domains\/([^/]+)\/dns$/);
            if (dnsMatch) {
              const id = dnsMatch[1]!;
              if (method === "GET") {
                const records = await listDnsRecords(id);
                return json({ records, count: records.length });
              }
              if (method === "POST") {
                const body = (await req.json()) as Omit<Parameters<typeof createDnsRecord>[0], "domain_id">;
                const record = await createDnsRecord({ ...body, domain_id: id });
                return json(record, 201);
              }
            }

            return notFound();
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : String(e) }, 500);
          }
        },
      });

      console.log(`✓ domains API server running at http://${opts.host}:${port}`);
      console.log(`  GET  /health`);
      console.log(`  GET  /domains`);
      console.log(`  POST /domains`);
      console.log(`  GET  /domains/:id`);
      console.log(`  PUT  /domains/:id`);
      console.log(`  DELETE /domains/:id`);
      console.log(`  GET  /domains/:id/dns`);
      console.log(`  POST /domains/:id/dns`);
      console.log(`\n  Press Ctrl+C to stop.`);

      // Keep alive
      await new Promise(() => {});
    });
}
