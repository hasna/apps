import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome = "";
let dbPath = "";

function runCli(args: string[], options: { env?: Record<string, string>; json?: boolean } = { json: true }) {
  return Bun.spawnSync({
    cmd: [process.execPath, "src/cli/index.ts", "--db", dbPath, ...(options.json === false ? [] : ["--json"]), ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SHORTLINKS_HOME: tempHome,
      HASNA_SHORTLINKS_DATABASE_URL: "",
      SHORTLINKS_DATABASE_URL: "",
      // Force the on-box LocalStore: neutralize any ambient hosted-API client
      // config — env (API_URL + API_KEY, canonical and alias prefixes) and the
      // fleet app-config on disk (HOME pointed at the temp dir) — so tests
      // never touch the real shortlinks API from a machine that has it
      // configured.
      HOME: tempHome,
      HASNA_SHORTLINKS_API_URL: "",
      HASNA_SHORTLINKS_API_KEY: "",
      SHORTLINKS_API_URL: "",
      SHORTLINKS_API_KEY: "",
      // The contracts resolver's deliberate-pointer and profile tiers: nothing
      // ambient may configure a hosted client behind the tests' backs.
      HASNA_SHORTLINKS_API_KEY_OVERRIDE: "",
      HASNA_SHORTLINKS_API_KEY_REF: "",
      HASNA_PROFILE: "",
      HASNA_EVENTS_HOME: join(tempHome, "events"),
      ...options.env,
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

  test("doctor reports the local Store without any DSN surface", () => {
    runCli(["init", "--domain", "has.na"]);
    const doctor = runCli(["doctor"]);
    expect(doctor.exitCode).toBe(0);
    const payload = JSON.parse(doctor.stdout.toString());
    expect(payload.ok).toBe(true);
    expect(payload.store).toBe("local");
    expect(payload.stats).toEqual({ domains: 1, links: 0, clicks: 0 });
    // No legacy DSN/runtime reporting leaks through.
    expect(payload.runtime).toBeUndefined();
    expect(payload.environment.api_url_present).toBe(false);
    expect(payload.environment.api_key_present).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("DATABASE_URL");
  });

  test("the removed postgres command group and --store flag are gone", () => {
    const status = runCli(["postgres", "status"]);
    expect(status.exitCode).not.toBe(0);

    const store = runCli(["--store", "postgres", "doctor"]);
    expect(store.exitCode).not.toBe(0);
  });

  test("keeps human link output compact and progressively discoverable", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    const longUrl = "https://example.com/landing-page-with-a-very-long-path-that-keeps-going-and-going?utm_source=agent-context&utm_campaign=compact-output";
    expect(runCli(["create", longUrl, "--slug", "alpha", "--title", "A title that should stay out of compact list output"]).exitCode).toBe(0);

    const list = runCli(["link", "list"], { json: false });
    expect(list.exitCode).toBe(0);
    const listText = list.stdout.toString();
    expect(listText).toContain("https://has.na/alpha -> https://example.com/landing-page");
    expect(listText).toContain("...");
    expect(listText).toContain("Showing 1 link(s).");
    expect(listText).toContain("Use `shortlinks link get <slug>` for details.");
    expect(listText).not.toContain("utm_campaign=compact-output");

    const get = runCli(["link", "get", "alpha"], { json: false });
    expect(get.exitCode).toBe(0);
    const getText = get.stdout.toString();
    expect(getText.trim().startsWith("{")).toBe(false);
    expect(getText).toContain("slug: alpha");
    expect(getText).toContain("Use `shortlinks link get <slug> --verbose` or `--json` for full details.");

    const verbose = runCli(["link", "get", "alpha", "--verbose"], { json: false });
    expect(verbose.exitCode).toBe(0);
    expect(JSON.parse(verbose.stdout.toString()).destination_url).toBe(longUrl);

    const json = runCli(["link", "get", "alpha"]);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout.toString()).destination_url).toBe(longUrl);
  });

  test("caps human list output with --limit while JSON remains machine-readable", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    for (const slug of ["one", "two", "three"]) {
      expect(runCli(["create", `https://example.com/${slug}`, "--slug", slug]).exitCode).toBe(0);
    }

    const limited = runCli(["link", "list", "--limit", "2"], { json: false });
    expect(limited.exitCode).toBe(0);
    const text = limited.stdout.toString();
    expect(text).toContain("/two");
    expect(text).toContain("/three");
    expect(text).not.toContain("/one");
    expect(text).toContain("Use --limit 4 or --json to see more rows.");

    const json = runCli(["link", "list", "--limit", "2"]);
    expect(json.exitCode).toBe(0);
    const rows = JSON.parse(json.stdout.toString());
    expect(rows).toHaveLength(2);
    expect(rows[0].destination_url).toBe("https://example.com/three");
  });

  test("summarizes stats and doctor in human mode without full object dumps", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    expect(runCli(["create", "https://example.com", "--slug", "home"]).exitCode).toBe(0);

    const stats = runCli(["stats", "home"], { json: false });
    expect(stats.exitCode).toBe(0);
    const statsText = stats.stdout.toString();
    expect(statsText.trim().startsWith("{")).toBe(false);
    expect(statsText).toContain("https://has.na/home clicks=0");
    expect(statsText).toContain("Use `shortlinks stats <slug> --verbose` or `--json` for full stats.");

    const doctor = runCli(["doctor"], { json: false });
    expect(doctor.exitCode).toBe(0);
    const doctorText = doctor.stdout.toString();
    expect(doctorText.trim().startsWith("{")).toBe(false);
    expect(doctorText).toContain("shortlinks doctor");
    expect(doctorText).toContain("stats: domains=1 links=1 clicks=0");
    expect(doctorText).toContain("Use `shortlinks doctor --verbose` or `--json` for paths and full readiness data.");
  });

  test("summarizes supporting config, domain, cloudflare, and local commands", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);

    const config = runCli(["config", "show"], { json: false });
    expect(config.exitCode).toBe(0);
    expect(config.stdout.toString()).toContain("shortlinks config");
    expect(config.stdout.toString()).toContain("Use `shortlinks config show --verbose` or `--json` for full config.");

    const domain = runCli(["domain", "get", "has.na"], { json: false });
    expect(domain.exitCode).toBe(0);
    expect(domain.stdout.toString()).toContain("* has.na manual default=yes");
    expect(domain.stdout.toString()).toContain("Use `shortlinks domain get <hostname> --verbose` or `--json` for full details.");

    const setupVerbose = runCli(["domain", "setup", "go.has.na", "--verbose"], { json: false });
    expect(setupVerbose.exitCode).toBe(0);
    expect(JSON.parse(setupVerbose.stdout.toString()).domain.hostname).toBe("go.has.na");

    const cloudflare = runCli(["cloudflare", "plan", "has.na", "--target", "shortlinks.example.com", "--origin", "https://shortlinks.example.com"], { json: false });
    expect(cloudflare.exitCode).toBe(0);
    expect(cloudflare.stdout.toString()).toContain("Cloudflare plan for has.na");
    expect(cloudflare.stdout.toString()).toContain("Use `--verbose` or `--json` for the full DNS payload.");

    const local = runCli(["local", "plan", "has.na"], { json: false });
    expect(local.exitCode).toBe(0);
    expect(local.stdout.toString()).toContain("Local plan for has.na");
    expect(local.stdout.toString()).toContain("Use `--verbose` or `--json` for the full Caddy snippet.");
  });

  test("bounds external domains command output unless verbose or JSON is requested", () => {
    const binDir = join(tempHome, "bin");
    mkdirSync(binDir, { recursive: true });
    const longLine = "x".repeat(180);
    const domainsBin = join(binDir, "domains");
    writeFileSync(domainsBin, `#!/usr/bin/env bash\nfor i in $(seq 1 25); do printf "line-%02d ${longLine}\\n" "$i"; done\n`);
    chmodSync(domainsBin, 0o755);
    const env = { PATH: `${binDir}:${process.env.PATH || ""}` };

    const compact = runCli(["domain", "check", "has.na"], { env, json: false });
    expect(compact.exitCode).toBe(0);
    const compactText = compact.stdout.toString();
    expect(compactText).toContain("line-20");
    expect(compactText).not.toContain("line-21");
    expect(compactText).not.toContain(longLine);
    expect(compactText).toContain("Use --verbose or --json for full domains check command output.");

    const verbose = runCli(["domain", "check", "has.na", "--verbose"], { env, json: false });
    expect(verbose.exitCode).toBe(0);
    expect(verbose.stdout.toString()).toContain("line-25");
    expect(verbose.stdout.toString()).toContain(longLine);

    const json = runCli(["domain", "check", "has.na"], { env });
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout.toString());
    expect(parsed.stdout).toContain("line-25");
    expect(parsed.stdout).toContain(longLine);
  });

  test("caps registered event and webhook list output by default", () => {
    for (let index = 0; index < 25; index += 1) {
      const emitted = runCli(["events", "emit", "shortlinks.test", "--subject", `event-${index}`, "--no-deliver"], { json: false });
      expect(emitted.exitCode).toBe(0);
    }

    const events = runCli(["events", "list"], { json: false });
    expect(events.exitCode).toBe(0);
    const eventLines = events.stdout.toString().trim().split("\n");
    expect(eventLines).toHaveLength(22);
    expect(events.stdout.toString()).toContain("Showing 20 of 25 event(s).");
    expect(events.stdout.toString()).toContain("Use --limit 25 or --json for more.");

    for (let index = 0; index < 25; index += 1) {
      const added = runCli(["webhooks", "add", `https://example.com/${index}`, "--id", `hook-${index}`], { json: false });
      expect(added.exitCode).toBe(0);
    }

    const webhooks = runCli(["webhooks", "list"], { json: false });
    expect(webhooks.exitCode).toBe(0);
    const webhookLines = webhooks.stdout.toString().trim().split("\n");
    expect(webhookLines).toHaveLength(22);
    expect(webhooks.stdout.toString()).toContain("Showing 20 of 25 channel(s).");
    expect(webhooks.stdout.toString()).toContain("Use --limit 25 or --json for more.");

    const webhooksJson = runCli(["webhooks", "list"]);
    expect(webhooksJson.exitCode).toBe(0);
    expect(JSON.parse(webhooksJson.stdout.toString())).toHaveLength(25);
  }, 60_000);
});

describe("CLI projects capability-bearing destination URLs (incident 716957)", () => {
  // Synthetic S3 V4 presigned-URL shape. Never a live capability.
  const PRESIGNED =
    "https://s3.amazonaws.com/bucket/object?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
    "&X-Amz-Credential=fleettestkey%2F20260820%2Fus-east-1%2Fs3%2Faws4_request" +
    "&X-Amz-Date=20260820T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host" +
    "&X-Amz-Signature=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  const SIGNATURE_VALUE = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

  test("link get --json emits the plain reference, never the signed capability", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    expect(runCli(["create", PRESIGNED, "--slug", "secret"]).exitCode).toBe(0);

    const get = runCli(["link", "get", "secret"]);
    expect(get.exitCode).toBe(0);
    const text = get.stdout.toString();
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).not.toContain(SIGNATURE_VALUE);
    expect(JSON.parse(text).destination_url).toBe("https://s3.amazonaws.com/bucket/object");
  });

  test("link list --json projects every row", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    expect(runCli(["create", "https://example.com/plain", "--slug", "plain"]).exitCode).toBe(0);
    expect(runCli(["create", PRESIGNED, "--slug", "secret"]).exitCode).toBe(0);

    const rows = JSON.parse(runCli(["link", "list"]).stdout.toString()) as Array<{ destination_url: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].destination_url).toBe("https://s3.amazonaws.com/bucket/object");
    expect(rows[1].destination_url).toBe("https://example.com/plain");
  });

  test("resolve projects in both JSON and human modes", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    expect(runCli(["create", PRESIGNED, "--slug", "secret"]).exitCode).toBe(0);

    const json = runCli(["resolve", "secret"]);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout.toString()).destination_url).toBe("https://s3.amazonaws.com/bucket/object");

    const human = runCli(["resolve", "secret"], { json: false });
    expect(human.exitCode).toBe(0);
    expect(human.stdout.toString().trim()).toBe("https://s3.amazonaws.com/bucket/object");
    expect(human.stdout.toString()).not.toContain("X-Amz-Signature");
  });

  test("stats output projects the destination in JSON and human modes", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    expect(runCli(["create", PRESIGNED, "--slug", "secret"]).exitCode).toBe(0);

    const statsJson = runCli(["stats", "secret"]);
    expect(statsJson.exitCode).toBe(0);
    expect(JSON.parse(statsJson.stdout.toString()).link.destination_url).toBe("https://s3.amazonaws.com/bucket/object");

    const statsHuman = runCli(["stats", "secret"], { json: false });
    expect(statsHuman.exitCode).toBe(0);
    expect(statsHuman.stdout.toString()).not.toContain("X-Amz-Signature");
    expect(statsHuman.stdout.toString()).not.toContain(SIGNATURE_VALUE);
  });

  test("human link output and --verbose JSON never carry the signed capability", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    expect(runCli(["create", PRESIGNED, "--slug", "secret"]).exitCode).toBe(0);

    const human = runCli(["link", "get", "secret"], { json: false });
    expect(human.exitCode).toBe(0);
    const text = human.stdout.toString();
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).not.toContain(SIGNATURE_VALUE);
    expect(text).toContain("https://s3.amazonaws.com/bucket/object");

    const verbose = runCli(["link", "get", "secret", "--verbose"], { json: false });
    expect(verbose.exitCode).toBe(0);
    expect(JSON.parse(verbose.stdout.toString()).destination_url).toBe("https://s3.amazonaws.com/bucket/object");

    const list = runCli(["link", "list"], { json: false });
    expect(list.stdout.toString()).not.toContain("X-Amz-Signature");
    expect(list.stdout.toString()).not.toContain(SIGNATURE_VALUE);
  });

  test("a plain destination still round-trips unchanged through every surface", () => {
    expect(runCli(["init", "--domain", "has.na"]).exitCode).toBe(0);
    const plainUrl = "https://example.com/page?utm_campaign=compact-output";
    expect(runCli(["create", plainUrl, "--slug", "plain"]).exitCode).toBe(0);

    const get = runCli(["link", "get", "plain"]);
    expect(JSON.parse(get.stdout.toString()).destination_url).toBe(plainUrl);

    const human = runCli(["resolve", "plain"], { json: false });
    expect(human.stdout.toString().trim()).toBe(plainUrl);
  });
});
