import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome = "";
let dbPath = "";

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", "--db", dbPath, "--json", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SHORTLINKS_HOME: tempHome,
      HASNA_SHORTLINKS_STORE: "",
      HASNA_SHORTLINKS_DATABASE_URL: "",
      HASNA_SHORTLINKS_DATABASE_SSL: "",
      SHORTLINKS_STORE: "",
      SHORTLINKS_DATABASE_URL: "",
      SHORTLINKS_DATABASE_SSL: "",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-cli-"));
  dbPath = join(tempHome, "shortlinks.db");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("CLI JSON workflow", () => {
  test("initializes has.na and creates a shortlink", () => {
    const init = runCli(["init", "--domain", "has.na"]);
    expect(init.exitCode).toBe(0);
    const initJson = JSON.parse(init.stdout.toString());
    expect(initJson.config.defaultDomain).toBe("has.na");

    const created = runCli(["create", "https://example.com", "--slug", "home"]);
    expect(created.exitCode).toBe(0);
    const link = JSON.parse(created.stdout.toString());
    expect(link.short_url).toBe("https://has.na/home");

    const stats = runCli(["stats"]);
    expect(stats.exitCode).toBe(0);
    expect(JSON.parse(stats.stdout.toString())).toEqual({ domains: 1, links: 1, clicks: 0 });
  });

  test("reports app-owned postgres status without network access", () => {
    const status = runCli(["postgres", "status"]);
    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout.toString());
    expect(payload.mode).toBe("local");
    expect(payload.no_network).toBe(true);
    expect(payload.database.configured).toBe(false);
    expect(payload.db_exists).toBe(false);
    expect(existsSync(dbPath)).toBe(false);
    expect(payload.canonical).toEqual({
      cluster: "hasna-xyz-infra-apps-prod-postgres",
      database: "shortlinks",
      runtimeSecretPath: "hasna/xyz/opensource/shortlinks/prod/postgres",
      primaryEnv: "HASNA_SHORTLINKS_DATABASE_URL",
      fallbackEnv: "SHORTLINKS_DATABASE_URL",
    });
    expect(payload.issues).toEqual([]);
  });

  test("redacts configured postgres URLs in status output", () => {
    const status = runCli(["postgres", "status"], {
      HASNA_SHORTLINKS_STORE: "postgres",
      HASNA_SHORTLINKS_DATABASE_URL: "postgres://shortlinks:super-secret@db.example.invalid:5432/shortlinks",
    });
    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout.toString());
    expect(payload.mode).toBe("postgres");
    expect(payload.database.configured).toBe(true);
    expect(payload.database.ssl).toBe(true);
    expect(payload.database.redacted_url).toContain("***:***@db.example.invalid");
    expect(payload.database.redacted_url).not.toContain("shortlinks:super-secret");
  });

  test("redacts postgres URL query credentials in status output", () => {
    const status = runCli(["--store", "postgres", "postgres", "status"], {
      HASNA_SHORTLINKS_DATABASE_URL: "postgres://shortlinks@db.example.invalid:5432/shortlinks?password=super-secret&sslmode=require&access_token=token-secret",
    });
    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout.toString());
    expect(payload.mode).toBe("postgres");
    expect(payload.database.redacted_url).toContain("password=***");
    expect(payload.database.redacted_url).toContain("access_token=***");
    expect(payload.database.redacted_url).not.toContain("super-secret");
    expect(payload.database.redacted_url).not.toContain("token-secret");
  });

  test("renders postgres plan with schema SQL without network access", () => {
    const plan = runCli(["--store", "postgres", "postgres", "plan", "--schema-sql"], {
      HASNA_SHORTLINKS_DATABASE_URL: "postgres://shortlinks:super-secret@db.example.invalid:5432/shortlinks",
    });
    expect(plan.exitCode).toBe(0);
    const payload = JSON.parse(plan.stdout.toString());
    expect(payload.dry_run).toBe(true);
    expect(payload.no_network).toBe(true);
    expect(payload.status.mode).toBe("postgres");
    expect(payload.postgres.configured).toBe(true);
    expect(payload.postgres.schema_sql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS domains");
    expect(payload.status.database.redacted_url).not.toContain("super-secret");
  });

  test("honors env ssl=false in postgres migrate dry-run", () => {
    const migrate = runCli(["postgres", "migrate", "--dry-run"], {
      HASNA_SHORTLINKS_DATABASE_URL: "postgres://shortlinks@db.example.invalid:5432/shortlinks",
      HASNA_SHORTLINKS_DATABASE_SSL: "false",
    });
    expect(migrate.exitCode).toBe(0);
    const payload = JSON.parse(migrate.stdout.toString());
    expect(payload.dry_run).toBe(true);
    expect(payload.no_network).toBe(true);
    expect(payload.database.ssl).toBe(false);
  });

  test("uses explicit no-ssl over env defaults in postgres migrate dry-run", () => {
    const migrate = runCli(["postgres", "migrate", "--dry-run", "--no-ssl"], {
      HASNA_SHORTLINKS_DATABASE_URL: "postgres://shortlinks@db.example.invalid:5432/shortlinks",
      HASNA_SHORTLINKS_DATABASE_SSL: "true",
    });
    expect(migrate.exitCode).toBe(0);
    expect(JSON.parse(migrate.stdout.toString()).database.ssl).toBe(false);
  });

  test("reports doctor runtime issues without opening the postgres store", () => {
    const doctor = runCli(["--store", "postgres", "doctor"]);
    expect(doctor.exitCode).toBe(0);
    const payload = JSON.parse(doctor.stdout.toString());
    expect(payload.ok).toBe(false);
    expect(payload.store).toBe("postgres");
    expect(payload.no_network).toBe(true);
    expect(payload.stats).toBe(null);
    expect(payload.runtime.issues[0]).toContain("HASNA_SHORTLINKS_DATABASE_URL is required");
  });

  test("selects postgres mode for serve before opening local SQLite", () => {
    const served = runCli(["--store", "postgres", "serve", "--port", "0"]);
    expect(served.exitCode).toBe(1);
    expect(JSON.parse(served.stdout.toString()).error).toContain("HASNA_SHORTLINKS_DATABASE_URL is required");
    expect(existsSync(dbPath)).toBe(false);
  });

  test("flags retired store mode names in status output", () => {
    const status = runCli(["postgres", "status"], {
      SHORTLINKS_STORE: "cloud",
    });
    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout.toString());
    expect(payload.ok).toBe(false);
    expect(payload.issues[0]).toContain("must be local or postgres");
  });
});
