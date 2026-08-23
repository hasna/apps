process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach } from "bun:test";
import { lookup as dnsLookup } from "node:dns/promises";
import { getDatabase, resetDatabase } from "./database.js";
import {
  createWebhookHook,
  getWebhookHook,
  listWebhookHooks,
  updateWebhookHook,
  deleteWebhookHook,
  recordWebhookInvocation,
  validateWebhookHandlerUrl,
} from "./webhook_hooks.js";
import type { WebhookUrlValidationOptions } from "./webhook_hooks.js";

/** Deterministic resolver stub — never touches the network. */
function stubResolver(
  addrs: { address: string; family: number }[] | Error
): NonNullable<WebhookUrlValidationOptions["lookup"]> {
  return async () => {
    if (addrs instanceof Error) throw addrs;
    return addrs;
  };
}

const PUBLIC_V4 = { address: "93.184.216.34", family: 4 };
const PUBLIC_V6 = { address: "2001:db8::1", family: 6 };

const opts = (lookup: NonNullable<WebhookUrlValidationOptions["lookup"]>): WebhookUrlValidationOptions => ({ lookup });

describe("webhook hooks", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("creates and retrieves a webhook hook", async () => {
    const db = getDatabase();
    const hook = await createWebhookHook(
      {
        type: "PostMemorySave",
        handlerUrl: "https://example.com/hook",
        priority: 10,
        blocking: true,
        description: "Test webhook",
      },
      db,
      opts(stubResolver([PUBLIC_V4]))
    );

    expect(hook.id).toHaveLength(8);
    expect(hook.type).toBe("PostMemorySave");
    expect(hook.handlerUrl).toBe("https://example.com/hook");
    expect(hook.priority).toBe(10);
    expect(hook.blocking).toBe(true);
    expect(hook.enabled).toBe(true);
    expect(hook.invocationCount).toBe(0);
    expect(hook.failureCount).toBe(0);

    const fetched = getWebhookHook(hook.id, db);
    expect(fetched?.description).toBe("Test webhook");
  });

  it("lists hooks filtered by type and enabled state", async () => {
    const db = getDatabase();
    await createWebhookHook({ type: "PostMemorySave", handlerUrl: "https://a.test/h" }, db, opts(stubResolver([PUBLIC_V4])));
    const disabled = await createWebhookHook(
      { type: "OnSessionStart", handlerUrl: "https://b.test/h" },
      db,
      opts(stubResolver([PUBLIC_V4]))
    );
    updateWebhookHook(disabled.id, { enabled: false }, db);

    expect(listWebhookHooks({}, db)).toHaveLength(2);
    expect(listWebhookHooks({ type: "PostMemorySave" }, db)).toHaveLength(1);
    expect(listWebhookHooks({ enabled: true }, db)).toHaveLength(1);
  });

  it("updates and deletes webhook hooks", async () => {
    const db = getDatabase();
    const hook = await createWebhookHook(
      { type: "PostMemorySave", handlerUrl: "https://c.test/h" },
      db,
      opts(stubResolver([PUBLIC_V4]))
    );

    const updated = updateWebhookHook(
      hook.id,
      { enabled: false, priority: 99, description: "Updated" },
      db
    );
    expect(updated?.enabled).toBe(false);
    expect(updated?.priority).toBe(99);
    expect(updated?.description).toBe("Updated");
    expect(updateWebhookHook("missing", { enabled: false }, db)).toBeNull();

    expect(deleteWebhookHook(hook.id, db)).toBe(true);
    expect(getWebhookHook(hook.id, db)).toBeNull();
    expect(deleteWebhookHook(hook.id, db)).toBe(false);
  });

  it("tracks invocation and failure counts", async () => {
    const db = getDatabase();
    const hook = await createWebhookHook(
      { type: "PostMemorySave", handlerUrl: "https://d.test/h" },
      db,
      opts(stubResolver([PUBLIC_V4]))
    );

    recordWebhookInvocation(hook.id, true, db);
    recordWebhookInvocation(hook.id, false, db);

    const stats = getWebhookHook(hook.id, db)!;
    expect(stats.invocationCount).toBe(2);
    expect(stats.failureCount).toBe(1);
  });
});

describe("validateWebhookHandlerUrl", () => {
  it("accepts public http(s) URLs", async () => {
    await expect(validateWebhookHandlerUrl("https://example.com/hook", opts(stubResolver([PUBLIC_V4, PUBLIC_V6])))).resolves.toBeUndefined();
    await expect(validateWebhookHandlerUrl("http://example.com:8080/hook", opts(stubResolver([PUBLIC_V4])))).resolves.toBeUndefined();
    await expect(validateWebhookHandlerUrl("https://hooks.example.com/path?q=1", opts(stubResolver([PUBLIC_V4])))).resolves.toBeUndefined();
    await expect(validateWebhookHandlerUrl("http://8.8.8.8/hook")).resolves.toBeUndefined();
    await expect(validateWebhookHandlerUrl("http://172.32.0.1/hook")).resolves.toBeUndefined();
    await expect(validateWebhookHandlerUrl("http://[2001:db8::1]/hook")).resolves.toBeUndefined();
  });

  it("rejects non-http(s) schemes and unparseable URLs", async () => {
    await expect(validateWebhookHandlerUrl("ftp://example.com/hook")).rejects.toThrow();
    await expect(validateWebhookHandlerUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(validateWebhookHandlerUrl("not a url")).rejects.toThrow();
    await expect(validateWebhookHandlerUrl("")).rejects.toThrow();
  });

  it("rejects loopback, link-local, private, and metadata targets", async () => {
    const blocked = [
      "http://127.0.0.1:43129/capture",
      "http://127.1/capture", // inet_aton shorthand for 127.0.0.1
      "http://2130706433/capture", // decimal shorthand for 127.0.0.1
      "http://0x7f000001/capture", // hex shorthand for 127.0.0.1
      "http://localhost/capture",
      "http://Localhost/capture",
      "http://foo.localhost/capture",
      "http://[::1]/capture",
      "http://[::ffff:127.0.0.1]/capture", // IPv4-mapped loopback
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/capture",
      "http://172.16.0.1/capture",
      "http://172.31.255.254/capture",
      "http://192.168.1.1/capture",
      "http://[fc00::1]/capture",
      "http://[fd00::1]/capture",
      "http://[fe80::1]/capture",
      "http://0.0.0.0/capture",
      "http://[::]/capture",
    ];
    for (const url of blocked) {
      await expect(validateWebhookHandlerUrl(url), url).rejects.toThrow(/not allowed/);
    }
  });

  it("rejects credentials embedded in the URL", async () => {
    await expect(validateWebhookHandlerUrl("http://user:pass@example.com/hook")).rejects.toThrow();
  });
});

describe("validateWebhookHandlerUrl — resolved-address checks (stubbed resolver, no network)", () => {
  it("rejects a hostname that resolves to a loopback address", async () => {
    await expect(
      validateWebhookHandlerUrl("http://evil.test/capture", opts(stubResolver([{ address: "127.0.0.1", family: 4 }])))
    ).rejects.toThrow(/not allowed/);
  });

  it("rejects a hostname that resolves to the cloud metadata / link-local range", async () => {
    await expect(
      validateWebhookHandlerUrl("http://evil.test/latest/meta-data/", opts(stubResolver([{ address: "169.254.169.254", family: 4 }])))
    ).rejects.toThrow(/not allowed/);
    await expect(
      validateWebhookHandlerUrl("http://evil.test/x", opts(stubResolver([{ address: "169.254.1.1", family: 4 }])))
    ).rejects.toThrow(/not allowed/);
  });

  it("rejects a hostname that resolves to private ranges (10/8, 172.16/12, 192.168/16)", async () => {
    for (const address of ["10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.255.255"]) {
      await expect(
        validateWebhookHandlerUrl("http://evil.test/x", opts(stubResolver([{ address, family: 4 }]))),
        address
      ).rejects.toThrow(/not allowed/);
    }
  });

  it("rejects a hostname that resolves to ::1, ::ffff-mapped, ULA, or link-local IPv6", async () => {
    for (const address of ["::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "fc00::1", "fd12:3456::1", "fe80::1"]) {
      await expect(
        validateWebhookHandlerUrl("http://evil.test/x", opts(stubResolver([{ address, family: 6 }]))),
        address
      ).rejects.toThrow(/not allowed/);
    }
  });

  it("rejects when ANY resolved address is blocked even if the name also has public records", async () => {
    // A name with both public and internal A records (misconfigured or hostile
    // DNS) must be rejected — fetch could connect to either.
    await expect(
      validateWebhookHandlerUrl("http://evil.test/x", opts(stubResolver([PUBLIC_V4, { address: "10.0.0.1", family: 4 }])))
    ).rejects.toThrow(/not allowed/);
    await expect(
      validateWebhookHandlerUrl("http://evil.test/x", opts(stubResolver([{ address: "169.254.169.254", family: 4 }, PUBLIC_V4])))
    ).rejects.toThrow(/not allowed/);
  });

  it("fails closed when the hostname cannot be resolved", async () => {
    await expect(
      validateWebhookHandlerUrl("http://no-such-host.invalid/hook", opts(stubResolver(new Error("ENOTFOUND: no such host"))))
    ).rejects.toThrow(/not allowed/);
  });

  it("fails closed when the hostname resolves to nothing", async () => {
    await expect(
      validateWebhookHandlerUrl("http://empty.test/hook", opts(stubResolver([])))
    ).rejects.toThrow(/not allowed/);
  });

  it("accepts a hostname that resolves only to public addresses (A and AAAA)", async () => {
    await expect(
      validateWebhookHandlerUrl("https://example.com/hook", opts(stubResolver([PUBLIC_V4, PUBLIC_V6])))
    ).resolves.toBeUndefined();
  });
});

// nip.io / sslip.io encode the target IP in the DNS name by design, and
// localtest.me always points at loopback — so whenever the network can
// resolve them, the resolved address is in the blocked ranges. These cases
// are gated on live resolution: when DNS is unavailable they are skipped
// rather than passing vacuously, and the resolved address itself is
// asserted against the range the NAME claims (an independent oracle).
// Resolution runs at module scope so the skip decision exists at
// definition time (it.skipIf cannot await).
const DNS_BYPASS_CASES: { url: string; host: string; claimsPrefix: string[] }[] = [
  { url: "http://127.0.0.1.nip.io/capture", host: "127.0.0.1.nip.io", claimsPrefix: ["127."] },
  { url: "http://169.254.169.254.nip.io/latest/meta-data/", host: "169.254.169.254.nip.io", claimsPrefix: ["169.254."] },
  { url: "http://10.0.0.1.nip.io/x", host: "10.0.0.1.nip.io", claimsPrefix: ["10."] },
  { url: "http://192.168.0.1.sslip.io/x", host: "192.168.0.1.sslip.io", claimsPrefix: ["192.168."] },
  { url: "http://127.0.0.1.sslip.io/x", host: "127.0.0.1.sslip.io", claimsPrefix: ["127."] },
  { url: "http://localtest.me/x", host: "localtest.me", claimsPrefix: ["127.", "::1"] },
];

const dnsBypassResolved: (string[] | null)[] = await Promise.all(
  DNS_BYPASS_CASES.map(async (c) => {
    try {
      const r = await dnsLookup(c.host, { all: true, verbatim: true });
      return r.map((a) => a.address);
    } catch {
      return null;
    }
  })
);

describe("validateWebhookHandlerUrl — DNS names resolving to blocked ranges (live DNS, gated)", () => {
  for (let i = 0; i < DNS_BYPASS_CASES.length; i++) {
    const c = DNS_BYPASS_CASES[i]!;
    const addrs = dnsBypassResolved[i];
    it.skipIf(addrs === null)(
      `rejects ${c.host}${addrs === null ? "" : ` (resolves to ${addrs.join(", ")})`}`,
      async () => {
        const resolvedAddrs = addrs!;
        // The name itself claims the blocked range — assert the resolver
        // agrees before trusting the rejection below.
        expect(
          resolvedAddrs.some((a) => c.claimsPrefix.some((p) => a.startsWith(p)))
        ).toBe(true);
        await expect(validateWebhookHandlerUrl(c.url)).rejects.toThrow(/not allowed/);
      }
    );
  }

  it("positive control: a public hostname is accepted (stubbed resolver)", async () => {
    // Deterministic positive control for the resolution path — the mechanism
    // must accept public addresses, so a suite that rejects everything cannot
    // pass. The live-DNS variant below adds the real-resolver check.
    await expect(
      validateWebhookHandlerUrl("https://example.com/hook", opts(stubResolver([PUBLIC_V4, PUBLIC_V6])))
    ).resolves.toBeUndefined();
  });

  it("positive control: a public hostname is accepted by the real resolver when DNS is available", async () => {
    let exampleAddrs: string[] | null = null;
    try {
      const r = await dnsLookup("example.com", { all: true, verbatim: true });
      exampleAddrs = r.map((a) => a.address);
    } catch {
      exampleAddrs = null;
    }
    if (exampleAddrs === null) {
      return; // no DNS — the stubbed positive control above still proves the mechanism
    }
    await expect(validateWebhookHandlerUrl("https://example.com/hook")).resolves.toBeUndefined();
  });
});
