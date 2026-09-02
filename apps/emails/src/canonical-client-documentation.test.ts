import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");
const prose = readme.replace(/\s+/g, " ");

describe("canonical client documentation", () => {
  test("installs without lifecycle-created application state and configures the API", () => {
    const install = readme.split("## Install\n")[1]?.split("\n## ")[0] ?? "";
    expect(install).toContain("--ignore-scripts");
    expect(readme).toContain("HASNA_EMAILS_API_URL");
    expect(readme).toContain("HASNA_EMAILS_API_KEY");
    expect(readme).toContain("EMAILS_SESSION_TOKEN");
    expect(readme).toContain("EMAILS_IDP_TOKEN");
  });

  test("does not instruct clients to select a retired mode or use local SQLite", () => {
    expect(readme).not.toMatch(/^(?:export\s+)?(?:HASNA_)?EMAILS_MODE=/m);
    expect(readme).not.toMatch(/must\s+select\s+`self_hosted`/);
    expect(readme).not.toContain("`local` by default");
    expect(readme).not.toContain("unset or blank means\nlocal SQLite");
    expect(readme).toContain("Remove retired selector variables");
    expect(prose.includes("Client database settings are rejected")).toBe(true);
    expect(readme).toContain("blank or conflicting aliases");
  });

  test("keeps service setup separate and documents the lack of automatic data migration", () => {
    expect(readme).toContain("HASNA_EMAILS_DATABASE_URL");
    expect(readme).toContain("no SQLite fallback");
    expect(readme).toContain("No existing database or attachment directory is deleted or migrated");
    expect(readme).toContain("Raw library storage helpers");
    expect(readme).not.toMatch(/^curl ['"]?localhost:3900\/api\//m);
  });

  test("does not recommend refused credential writes or client-side ingestion commands", () => {
    const shellExamples = [...readme.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map(match => match[1]!).join("\n");
    expect(/emails provider add[^\n]*--(?:api|access|secret)-key\b/.test(shellExamples)).toBe(false);
    expect(/^emails inbox (?:sync-s3|setup-realtime|realtime-status|watch)\b/m.test(shellExamples)).toBe(false);
    expect(prose.includes("Provider credentials are configured on the service")).toBe(true);
    expect(prose.includes("These client commands intentionally refuse")).toBe(true);
    expect(readme.includes("emails-serve ingest-worker")).toBe(true);
  });
});
