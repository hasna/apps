import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addDomainMapping, listDomainMappings, renderDomainMapping } from "../src/commands/dns.js";

describe("dns mappings", () => {
  test("stores and renders local domains", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-dns-"));
    process.env["HASNA_MACHINES_DIR"] = dir;

    addDomainMapping("app.local", 3000);
    const mappings = listDomainMappings();
    expect(mappings[0]?.domain).toBe("app.local");

    const rendered = renderDomainMapping("app.local");
    expect(rendered.hostsEntry).toBe("127.0.0.1 app.local");
    expect(rendered.caddySnippet).toContain("reverse_proxy 127.0.0.1:3000");
  });
});
