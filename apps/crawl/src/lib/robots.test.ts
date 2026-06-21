import { afterEach, describe, expect, it } from "bun:test";
import { fetchRobotsTxt } from "./robots.js";

const servers: Bun.Server[] = [];

function serveRobotsTxt(body: string): string {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/robots.txt") {
        return new Response(body, {
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  return `127.0.0.1:${server.port}`;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("fetchRobotsTxt", () => {
  it("uses the specific user-agent group instead of merging wildcard rules", async () => {
    const domain = serveRobotsTxt(`
User-agent: *
Disallow: /

User-agent: open-crawl
Allow: /
`);

    const robots = await fetchRobotsTxt(domain, "open-crawl/1.0");

    expect(robots.isAllowed(`http://${domain}/private-page`)).toBe(true);
  });

  it("starts a new group when user-agent appears after rules without a blank line", async () => {
    const domain = serveRobotsTxt(`
User-agent: *
Allow: /private
User-agent: open-crawl
Disallow: /
`);

    const robots = await fetchRobotsTxt(domain, "open-crawl/1.0");

    expect(robots.isAllowed(`http://${domain}/private`)).toBe(false);
  });

  it("ignores inline comments in directive values", async () => {
    const domain = serveRobotsTxt(`
User-agent: * # all crawlers
Disallow: /private # keep out
`);

    const robots = await fetchRobotsTxt(domain, "open-crawl/1.0");

    expect(robots.isAllowed(`http://${domain}/private/page`)).toBe(false);
  });

  it("keeps rules in the same group across blank lines", async () => {
    const domain = serveRobotsTxt(`
User-agent: open-crawl

Disallow: /private
`);

    const robots = await fetchRobotsTxt(domain, "open-crawl/1.0");

    expect(robots.isAllowed(`http://${domain}/private/page`)).toBe(false);
  });
});
