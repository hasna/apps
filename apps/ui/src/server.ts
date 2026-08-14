// ui-local server — the offline counterpart to ui.sh:
//   GET /                       demo UI with variant picker (?picker=local|reference)
//   GET /ui-picker.js           OUR self-contained picker (public/ui-picker.js)
//   GET /ui-picker.reference.js the real ui.sh picker (demo/ui-picker.reference.js)
//   GET /fetch?uri=uidotsh://…  HTTP shim over the mirrored content (= uidotsh_fetch)
//   GET /health                 ok
//
// Binds 0.0.0.0 so other LAN/Tailscale machines can reach it.

import { join } from "node:path";
import { fetchResource } from "./fetch.ts";
import { demoHtml } from "./demo.ts";

const ROOT = join(import.meta.dir, "..");
const PORT = Number(process.env.UI_LOCAL_PORT ?? 5173);

const file = (p: string) => Bun.file(join(ROOT, p));

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") return new Response("ok");

    if (path === "/ui-picker.js") {
      return new Response(file("public/ui-picker.js"), {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
      });
    }
    if (path === "/ui-picker.reference.js") {
      return new Response(file("demo/ui-picker.reference.js"), {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
      });
    }

    if (path === "/fetch") {
      const uri = url.searchParams.get("uri") ?? undefined;
      const uris = url.searchParams.getAll("uris");
      try {
        const text = await fetchResource({ uri, uris: uris.length ? uris : undefined });
        return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
      } catch (e) {
        return new Response((e as Error).message, { status: 404 });
      }
    }

    if (path === "/" || path === "/index.html") {
      const which = url.searchParams.get("picker") === "reference" ? "reference" : "local";
      const src = which === "reference" ? "/ui-picker.reference.js" : "/ui-picker.js";
      return new Response(demoHtml(src, which), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`[ui-local] serving on http://0.0.0.0:${server.port}`);
console.log(`  demo (our picker):       http://localhost:${server.port}/?picker=local`);
console.log(`  demo (reference picker): http://localhost:${server.port}/?picker=reference`);
console.log(`  fetch shim:              http://localhost:${server.port}/fetch?uri=uidotsh://ui`);
