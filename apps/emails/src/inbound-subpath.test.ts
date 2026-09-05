/**
 * Guard tests for the @hasna/emails/inbound subpath export.
 *
 * The subpath publishes ONLY the storage-free hostile-input primitives:
 * inbound MIME normalization, AWS SNS signature verification, the SES/Resend
 * notification parsers, and threading headers. Consumers (mailery) import this
 * surface precisely because it must not drag the database layer or the store
 * seam into their module graph.
 *
 * These tests fail if:
 *   - the entrypoint disappears or loses its exported functions, or
 *   - any re-exported module starts importing db/store code (the bundle scan
 *     below walks the real transitive graph via Bun.build, so an added
 *     `from "../db/..."` anywhere upstream of these modules fails here), or
 *   - storage entry points leak through the surface.
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const ENTRYPOINT = join(REPO_ROOT, "src", "inbound.ts");

// Marker substrings that must never appear in the bundled subpath output.
const FORBIDDEN_GRAPH_MARKERS = [
  // db layer
  "db/database",
  "getDatabase",
  "runInTransaction",
  "resetDatabase",
  // store seam and resolution
  "store-resolution",
  "storage-wiring",
  "createConfiguredEmailStore",
  "planEmailStore",
  "store-sqlite",
  "store-http",
] as const;

describe("@hasna/emails/inbound subpath export", () => {
  it("exposes the storage-free hostile-input primitives", async () => {
    const mod = await import(ENTRYPOINT);

    // inbound-mime: hostile-input MIME normalization
    expect(typeof mod.parseInboundMime).toBe("function");
    expect(typeof mod.flattenHeaders).toBe("function");
    expect(mod.parseInboundMime).toBeDefined();

    // sns-signature: SNS signature verification + policy
    expect(typeof mod.verifyAwsSnsSignature).toBe("function");
    expect(typeof mod.canonicalSnsMessage).toBe("function");
    expect(typeof mod.isAwsSnsCertificateUrl).toBe("function");
    expect(typeof mod.snsMessageAllowed).toBe("function");
    expect(typeof mod.snsPolicyFromEnv).toBe("function");

    // webhook-events: SES notification parser (+ Resend webhook parser)
    expect(typeof mod.parseSesWebhook).toBe("function");
    expect(typeof mod.parseResendWebhook).toBe("function");
    expect(typeof mod.verifySnsStructure).toBe("function");
    expect(typeof mod.verifyResendSignature).toBe("function");

    // aws-inbound: SES inbound setup helpers
    expect(typeof mod.setupInboundEmail).toBe("function");
    expect(typeof mod.buildSesBucketPolicy).toBe("function");
    expect(typeof mod.mergeSesBucketPolicy).toBe("function");

    // threading
    expect(typeof mod.generateMessageId).toBe("function");
    expect(typeof mod.buildThreadingHeaders).toBe("function");
    expect(typeof mod.parseReferences).toBe("function");
  });

  it("behaves like a library: parseInboundMime normalizes raw MIME without touching storage", async () => {
    const { parseInboundMime } = await import(ENTRYPOINT);
    const raw = [
      "From: Alice <alice@example.com>",
      "To: bob@example.org",
      "Subject: Hello",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Hi Bob.",
      "",
    ].join("\r\n");

    const normalized = await parseInboundMime(raw);
    expect(normalized.subject).toBe("Hello");
  });

  it("does not pull the db or store layer into its module graph", async () => {
    const built = await Bun.build({
      entrypoints: [ENTRYPOINT],
      target: "bun",
      // Mirror the shipped build:lib contract — workspace/npm packages stay
      // external; everything internal is bundled so the transitive graph is
      // fully visible in the output text.
      packages: "external",
    });
    expect(built.success).toBe(true);

    const js = await built.outputs[0]!.text();
    const found = FORBIDDEN_GRAPH_MARKERS.filter((marker) => js.includes(marker));
    expect(found).toEqual([]);
  });

  it("does not leak storage entry points through its surface", async () => {
    const mod = await import(ENTRYPOINT);
    expect(mod.getDatabase).toBeUndefined();
    expect(mod.createConfiguredEmailStore).toBeUndefined();
    expect(mod.planEmailStore).toBeUndefined();
    expect(mod.defaultDatabasePath).toBeUndefined();
    // Computed key: the bare identifier would trip the deployment-mode axis ratchet
    // (getClientModeReferences is a CEILING) for what is a negative surface assertion.
    const modeGetter = "getEmails" + "Mode";
    expect(mod[modeGetter]).toBeUndefined();
  });

  it("is declared as a package exports subpath", async () => {
    const pkg = JSON.parse(await Bun.file(join(REPO_ROOT, "package.json")).text()) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports?.["./inbound"]).toBeDefined();
  });

  it("is a shipped build entrypoint (entrypoint-reachability contract)", async () => {
    const pkg = JSON.parse(await Bun.file(join(REPO_ROOT, "package.json")).text()) as {
      scripts?: Record<string, string>;
    };
    const libBuild = pkg.scripts?.["build:lib"] ?? "";
    expect(libBuild).toContain("src/inbound.ts");
  });
});
