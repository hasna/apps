// Self-hosted-ONLY: the domain repo routes every read/write to `/v1/domains`
// (and providers to `/v1/providers`), so these tests drive the REAL command
// against an out-of-process /v1 stub (see src/test-support/v1-stub.ts). The
// deleted `../../db/database.js` and all local-SQLite seeding are gone.
//
// What is covered here (command-level behaviour on top of /v1):
//   - `domain add` / `domains add` dry-run planning (no mutation)
//   - `domain buy` Route 53 contact normalization (pure @hasna/domains, mocked)
//   - `domain list` and `domain usable` pagination/filtering over /v1
//   - `domain move-provider` writing through /v1 (server owns address moves)
//   - `domain warm-list` reading the /v1 `warming` resource
//   - the genuinely server-owned commands that fail loud (live DNS/provider
//     orchestration and the lifecycle-readiness ledger)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Command } from "commander";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerDomainCommands } from "./domain.js";

const mockR53CheckAvailability = mock(async (domain: string) => ({
  domain,
  available: true,
  price: "12",
  currency: "USD",
}));
const mockR53RegisterDomain = mock(async () => ({ operationId: "op-123" }));

mock.module("@hasna/domains", () => ({
  r53CheckAvailability: mockR53CheckAvailability,
  r53RegisterDomain: mockR53RegisterDomain,
}));

let stub: V1Stub;

async function runDomainCommand(args: string[]) {
  const program = new Command();
  program.exitOverride();
  let data: unknown;
  const out: string[] = [];
  registerDomainCommands(program, (d, formatted) => {
    data = d;
    out.push(String(formatted ?? ""));
  });
  await program.parseAsync(["node", "emails", ...args]);
  return { data, out: out.join("\n") };
}

// Server-owned subcommands call handleError() -> console.error + process.exit(1).
async function runDomainCommandExpectingExit(args: string[]) {
  const originalExit = process.exit;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = ((message?: unknown) => { errors.push(String(message ?? "")); }) as typeof console.error;
  process.exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as typeof process.exit;
  try {
    await runDomainCommand(args);
    throw new Error("Expected command to exit");
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), stderr: errors.join("\n") };
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

beforeAll(async () => {
  // `openapi: true` because the collapsed warming family reaches `/v1` through the
  // REAL HTTP store, which reads the service's published contract before any
  // filtered list or write; a missing document is deliberately a fault there.
  stub = await startV1Stub({ openapi: true });
});
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
  mockR53CheckAvailability.mockReset();
  mockR53CheckAvailability.mockImplementation(async (domain: string) => ({
    domain,
    available: true,
    price: "12",
    currency: "USD",
  }));
  mockR53RegisterDomain.mockReset();
  mockR53RegisterDomain.mockImplementation(async () => ({ operationId: "op-123" }));
});
afterEach(() => stub.clearEnv());

describe("domain add command", () => {
  it("supports dry-run without mutating domain state", async () => {
    const result = await runDomainCommand(["domain", "add", "example.com", "--provider", "sandbox", "--dry-run"]);

    expect(result.data).toMatchObject({
      dry_run: true,
      domain: "example.com",
      provider_id: "sandbox",
      would_create_domain: true,
      // The self-hosted client never calls a provider adapter — the /v1 API owns creation.
      would_call_provider: false,
    });
    expect(await stub.list("domains")).toHaveLength(0);
  });
});

describe("domain buy command", () => {
  it("omits Route53 contact state for Romania even when --state is provided", async () => {
    await runDomainCommand([
      "domain", "buy", "example.ro",
      "--email", "owner@example.com",
      "--first-name", "Mika",
      "--last-name", "Paper",
      "--phone", "+40.123456789",
      "--address", "Main 1",
      "--city", "Bucuresti",
      "--state", "Bucuresti",
      "--country", "RO",
      "--zip", "010101",
    ]);

    const contact = mockR53RegisterDomain.mock.calls[0]?.[1] as { state?: string; country_code?: string };
    expect(contact.country_code).toBe("RO");
    expect("state" in contact).toBe(false);
  });

  it("allows domain purchase without --state and preserves it for countries that accept it", async () => {
    await runDomainCommand([
      "domain", "buy", "example.com",
      "--email", "owner@example.com",
      "--first-name", "Mika",
      "--last-name", "Paper",
      "--phone", "+1.5551234567",
      "--address", "Main 1",
      "--city", "Seattle",
      "--country", "US",
      "--zip", "98101",
    ]);
    expect(mockR53RegisterDomain.mock.calls[0]?.[1]).not.toHaveProperty("state");

    mockR53RegisterDomain.mockClear();
    await runDomainCommand([
      "domain", "buy", "example.net",
      "--email", "owner@example.com",
      "--first-name", "Mika",
      "--last-name", "Paper",
      "--phone", "+1.5551234567",
      "--address", "Main 1",
      "--city", "Seattle",
      "--state", "WA",
      "--country", "US",
      "--zip", "98101",
    ]);
    expect(mockR53RegisterDomain.mock.calls[0]?.[1]).toMatchObject({ state: "WA", country_code: "US" });
  });
});

describe("domain list command", () => {
  it("paginates domain output from /v1", async () => {
    await stub.seed({
      domains: [1, 2, 3, 4].map((i) => ({
        id: `dom-${i}`,
        domain: `domain-${i}.example.com`,
        provider: "sandbox",
        verified: false,
        created_at: `2026-01-0${i}T00:00:00.000Z`,
      })),
    });

    const result = await runDomainCommand([
      "domain", "list",
      "--provider", "sandbox",
      "--limit", "2",
      "--offset", "1",
    ]);

    // Newest-first ordering: 4, 3, 2, 1 -> offset 1, limit 2 -> 3, 2.
    expect(result.out).toContain("domain-3.example.com");
    expect(result.out).toContain("domain-2.example.com");
    expect(result.out).not.toContain("domain-4.example.com");
    expect(result.data).toMatchObject([
      { domain: "domain-3.example.com" },
      { domain: "domain-2.example.com" },
    ]);
  });
});

describe("domains lifecycle commands", () => {
  it("supports plural add dry-run without mutating state", async () => {
    const result = await runDomainCommand([
      "domains", "add", "example.com",
      "--provider", "sandbox",
      "--dry-run",
    ]);

    expect(result.data).toMatchObject({
      dry_run: true,
      domain: "example.com",
      provider_id: "sandbox",
      // Reported, not requested: the client always creates `/v1`-owned domains.
      source_of_truth: "postgres",
      would_create_domain: true,
      cli_equivalent: "emails domains add example.com --provider sandbox",
    });
    expect(await stub.list("domains")).toHaveLength(0);
  });

  // The flag was declared on all four of these and read by nothing: the action
  // reports a hardcoded "postgres". Commander now rejects it, so the CLI can no
  // longer accept an input it silently discards.
  it("rejects --source-of-truth instead of silently discarding it", async () => {
    for (const command of ["add", "connect"]) {
      for (const noun of ["domain", "domains"]) {
        await expect(runDomainCommand([
          noun, command, "example.com", "--provider", "sandbox", "--source-of-truth", "postgres",
        ])).rejects.toThrow(/unknown option '--source-of-truth'/);
      }
    }
  });

  it("reports an older API without connect orchestration and creates no fallback state", async () => {
    const result = await runDomainCommandExpectingExit(["domains", "connect", "owned.example.com", "--provider", "x"]);
    expect(result.error).toBe("process.exit:1");
    expect(result.stderr).toContain("POST /v1/domains/connect");
    expect(result.stderr).toContain("405");
    expect(await stub.list("domains")).toHaveLength(0);
  });

});

describe("domain move-provider command", () => {
  it("moves a domain to another provider through /v1 (server owns address moves)", async () => {
    await stub.seed({
      providers: [
        { id: "prov-source", name: "ses-sandbox", type: "ses", region: "us-east-1", active: true },
        { id: "prov-target", name: "ses-production", type: "ses", region: "us-east-1", active: true },
      ],
      domains: [
        { id: "dom-1", domain: "example.com", provider: "prov-source", verified: false },
      ],
    });

    const result = await runDomainCommand([
      "domain", "move-provider", "example.com",
      "--from-provider", "prov-source",
      "--to-provider", "prov-target",
      "--yes",
    ]);

    expect(result.data).toMatchObject({
      domain: { provider_id: "prov-target", domain: "example.com" },
      to_provider_name: "ses-production",
      moved_addresses: 0,
    });
    // The write reached /v1: the stored row now points at the new provider.
    const stored = (await stub.list("domains")).find((d) => d["id"] === "dom-1");
    expect(stored?.["provider"]).toBe("prov-target");
  });
});

describe("domain status command", () => {
  it("shows the server registry without a legacy refusal", async () => {
    const result = await runDomainCommand(["domain", "status"]);
    expect(result.data).toEqual([]);
  });
});

describe("domain dns command", () => {
  // `domain dns` and `domain check` were unconditional refusals whose entire
  // implementation already shipped in src/lib/dns.ts and src/lib/dns-check.ts —
  // pure, tested, mode-free code that no command reached. `dns` resolves nothing
  // over the network, so it is asserted here; `check` is asserted live in
  // src/cli/unshipped-surface.test.ts.
  it("returns the generic SPF/DMARC pair when no provider resolves", async () => {
    const result = await runDomainCommand(["domain", "dns", "unregistered.example.com"]);
    expect(result.data).toMatchObject({
      domain: "unregistered.example.com",
      provider_id: null,
      records: [
        { purpose: "SPF", type: "TXT", name: "unregistered.example.com" },
        { purpose: "DMARC", type: "TXT", name: "_dmarc.unregistered.example.com" },
      ],
    });
    // Silently omitting DKIM would read as "no DKIM required", so say it.
    expect(result.out).toContain("No provider resolved");
    expect(result.out).toContain("Pass --provider <id> to include the provider's DKIM records.");
  });

  it("refuses an unresolvable --provider instead of falling back to generic records", async () => {
    const result = await runDomainCommandExpectingExit([
      "domain", "dns", "example.com", "--provider", "does-not-exist",
    ]);
    expect(result.error).toBe("process.exit:1");
    expect(result.stderr).not.toContain("v=spf1");
  });

  it("explains an EMPTY provider table instead of printing the unknown-provider fallback", async () => {
    // A sandbox adapter returns [] BY DESIGN. Without the `DnsPublishingSupport`
    // descriptor `formatDnsTable` can only print its ambiguous fallback, which reads
    // as a failed lookup for a provider that has nothing to publish in the first
    // place. This is the half of #103's dns.ts work the recovered CLI path did not
    // reach: it called `formatDnsTable(records)` with no second argument, so the
    // better message existed and only the MCP twin could produce it.
    await stub.seed({
      providers: [{ id: "prov-box", name: "sandbox-1", type: "sandbox", active: true }],
      domains: [{ id: "dom-box", domain: "boxed.example.com", provider: "prov-box", verified: false }],
    });

    const result = await runDomainCommand(["domain", "dns", "boxed.example.com"]);

    expect(result.data).toMatchObject({ domain: "boxed.example.com", provider_id: "prov-box", records: [] });
    expect(result.out).toContain("No DNS records to publish, and none are expected");
    expect(result.out).toContain("has no DKIM, SPF or DMARC of its own");
    expect(result.out).toContain("emails domain move-provider <domain> --to-provider <id>");
    // The ambiguous sentence is the thing being replaced, so it must be absent.
    expect(result.out).not.toContain("No DNS records found.");
    // A provider DID resolve, so the no-provider caveat must not fire.
    expect(result.out).not.toContain("No provider resolved");
  });

  it("does not contradict the 'domain check' it recommends in its own next-step line", async () => {
    // `dnsAction` got the `DnsPublishingSupport` descriptor and `checkAction` did not,
    // even though both read the same `expectedDnsRecords`. So `domain dns` answered
    // "Nothing is missing" while the `domain check` it names one line later answered
    // the unconditioned "No DNS records to check." — the same ambiguity, one command
    // apart, on the command that recommends the other.
    await stub.seed({
      providers: [{ id: "prov-agree", name: "sandbox-agree", type: "sandbox", active: true }],
      domains: [{ id: "dom-agree", domain: "agree.example.com", provider: "prov-agree", verified: false }],
    });

    const dns = await runDomainCommand(["domain", "dns", "agree.example.com"]);
    const check = await runDomainCommand(["domain", "check", "agree.example.com"]);

    // The recommendation is real: `dns` names `check`, so they must not disagree.
    expect(dns.out).toContain("emails domain check agree.example.com");
    for (const out of [dns.out, check.out]) {
      expect(out).toContain("has no DKIM, SPF or DMARC of its own");
      expect(out).toContain("emails domain move-provider <domain> --to-provider <id>");
    }
    expect(check.out).not.toContain("No DNS records to check.");
  });

  it("does not claim in a refusal that 'domain check' needs no provider", async () => {
    // `emails domain verify`'s refusal said "'emails domain check <domain>' reads the
    // published DNS directly and needs no provider." That is false: `check` resolves
    // the domain's registered provider when it has one, which is how DKIM gets into
    // the answer at all. A false sentence inside a refusal is the exact defect the
    // refusal rewrite existed to remove, so it does not get to survive in it.
    await stub.seed({
      providers: [{ id: "prov-vfy", name: "sandbox-vfy", type: "sandbox", active: true }],
      domains: [{ id: "dom-vfy", domain: "vfy.example.com", provider: "prov-vfy", verified: false }],
    });

    const refusal = await runDomainCommandExpectingExit(["domain", "verify", "vfy.example.com"]);
    expect(refusal.error).toBe("process.exit:1");
    expect(refusal.stderr).not.toContain("is not implemented in this build");
    expect(refusal.stderr).not.toContain("needs no provider");

    // And the claim is checked against the command itself, not just reworded: a
    // registered domain reports the provider it resolved.
    const registered = await runDomainCommand(["domain", "check", "vfy.example.com"]);
    expect(registered.data).toMatchObject({ provider_id: "prov-vfy" });
    const unregistered = await runDomainCommand(["domain", "check", "unregistered.example.com"]);
    expect(unregistered.data).toMatchObject({ provider_id: null });
  });

  it("retrieves server-bound DKIM without distributing provider credentials", async () => {
    const record = { type: "CNAME", name: "key._domainkey.nokey.example.com", value: "key.provider.example", purpose: "DKIM", status: "pending" };
    await stub.seed({
      providers: [{ id: "prov-nokey", name: "resend-nokey", type: "resend", active: true }],
      domains: [{ id: "dom-nokey", domain: "nokey.example.com", provider: "prov-nokey", verified: false }],
      "dns-records": [{ domain_id: "dom-nokey", domain: "nokey.example.com", provider_id: "prov-nokey", source: "live_provider", verified_for_sending: false, checked_at: "2026-09-07T00:00:00Z", records: [record] }],
    });
    const result = await runDomainCommand(["domain", "dns", "nokey.example.com"]);
    expect(result.data).toMatchObject({ domain: "nokey.example.com", provider_id: "prov-nokey", dkim_unavailable: null, records: [record] });
    expect(result.out).toContain("key._domainkey.nokey.example.com");
    expect(result.out).not.toContain("requires an API key");
    expect(result.out).not.toContain("No provider resolved");
  });
});

describe("domain usable command", () => {
  it("paginates verified domains from /v1", async () => {
    await stub.seed({
      domains: [1, 2, 3, 4].map((i) => ({
        id: `use-${i}`,
        domain: `usable-${i}.example.com`,
        provider: "ses",
        verified: true,
        created_at: `2026-01-0${i}T00:00:00.000Z`,
      })),
    });

    const result = await runDomainCommand(["domain", "usable", "--send", "--limit", "2", "--offset", "1"]);

    expect(result.out).toContain("usable-3.example.com");
    expect(result.out).toContain("usable-2.example.com");
    expect(result.out).not.toContain("usable-4.example.com");
    expect(result.data).toMatchObject([
      { domain: "usable-3.example.com" },
      { domain: "usable-2.example.com" },
    ]);
  });

  it("filters by provider label", async () => {
    await stub.seed({
      domains: [
        { id: "d1", domain: "first.example.com", provider: "first-ses", verified: true, created_at: "2026-01-01T00:00:00.000Z" },
        { id: "d2", domain: "second.example.com", provider: "second-ses", verified: true, created_at: "2026-01-02T00:00:00.000Z" },
      ],
    });

    const result = await runDomainCommand(["domain", "usable", "--provider", "first-ses"]);

    expect(result.out).toContain("first.example.com");
    expect(result.out).not.toContain("second.example.com");
    expect(result.data).toMatchObject([
      { domain: "first.example.com", provider_id: "first-ses" },
    ]);
  });
});

describe("domain warm-list command", () => {
  it("lists warming schedules from /v1 with --status filtering and pagination", async () => {
    await stub.seed({
      warming: [1, 2, 3].map((i) => ({
        id: `warm-${i}`,
        domain: `warm-${i}.example.com`,
        provider_id: null,
        target_daily_volume: 100 * i,
        start_date: "2026-01-01",
        status: i === 3 ? "paused" : "active",
        created_at: `2026-01-0${i}T00:00:00.000Z`,
        updated_at: `2026-01-0${i}T00:00:00.000Z`,
      })),
    });

    const all = await runDomainCommand(["domain", "warm-list"]);
    // Newest-first, exactly like every other /v1-backed list command.
    expect((all.data as Array<{ domain: string }>).map((row) => row.domain)).toEqual([
      "warm-3.example.com",
      "warm-2.example.com",
      "warm-1.example.com",
    ]);
    expect(all.out).toContain("warm-1.example.com");
    expect(all.out).toContain("Showing 3 warming schedules");

    const active = await runDomainCommand(["domain", "warm-list", "--status", "active"]);
    expect((active.data as Array<{ domain: string }>).map((row) => row.domain)).toEqual([
      "warm-2.example.com",
      "warm-1.example.com",
    ]);

    const page = await runDomainCommand(["domain", "warm-list", "--limit", "1", "--offset", "1"]);
    expect((page.data as Array<{ domain: string }>).map((row) => row.domain)).toEqual(["warm-2.example.com"]);
  });

  it("rejects an unknown --status instead of returning everything", async () => {
    const result = await runDomainCommandExpectingExit(["domain", "warm-list", "--status", "warming"]);
    expect(result.error).toBe("process.exit:1");
    expect(result.stderr).toContain("Invalid --status 'warming'");
  });
});
