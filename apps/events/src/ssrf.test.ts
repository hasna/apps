import { describe, expect, test } from "bun:test";
import { createEvent } from "./index.js";
import { dispatchWebhook } from "./transports.js";
import {
  assertWebhookTargetAllowed,
  isPrivateAddress,
  resolveWebhookTarget,
  type WebhookTargetPolicy,
} from "./ssrf.js";

describe("webhook target SSRF guard", () => {
  test("classifies private and special-use IPv4 addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "127.255.255.255",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.10",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.10",
      "203.0.113.10",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  test("classifies private and special-use IPv6 addresses", () => {
    for (const address of [
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.5",
      "::ffff:7f00:1",
      "64:ff9b::1",
      "100::1",
      "2001::1",
      "2001:2::1",
      "2001:10::1",
      "2001:db8::1",
      "2002:7f00:1::",
      "3fff::1",
      "fc00::1",
      "fdff::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  test("accepts public IPv4 and IPv6 addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "2606:4700::1", "2001:4860:4860::8888"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  test("rejects private IP literals and unresolvable or private hostname targets by default", async () => {
    await expect(assertWebhookTargetAllowed(new URL("http://127.0.0.1/x"))).rejects.toThrow(/private or special-use/);
    await expect(assertWebhookTargetAllowed(new URL("http://10.0.0.5/x"))).rejects.toThrow(/private or special-use/);
    await expect(assertWebhookTargetAllowed(new URL("http://169.254.169.254/latest/meta-data/"))).rejects.toThrow(/private or special-use/);
    await expect(assertWebhookTargetAllowed(new URL("http://[::1]/x"))).rejects.toThrow(/private or special-use/);
    await expect(assertWebhookTargetAllowed(new URL("http://[::ffff:7f00:1]/x"))).rejects.toThrow(/private or special-use/);

    const policy: WebhookTargetPolicy = {
      lookup: async () => [],
    };
    await expect(assertWebhookTargetAllowed(new URL("http://target.test/x"), policy)).rejects.toThrow(/no addresses/);
  });

  test("rejects mixed DNS answers where any resolved address is private", async () => {
    const policy: WebhookTargetPolicy = {
      lookup: async (hostname) => {
        if (hostname === "mixed.test") return [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }];
        if (hostname === "rebind.test") return [{ address: "169.254.169.254", family: 4 }];
        if (hostname === "public.test") return [{ address: "1.1.1.1", family: 4 }, { address: "2606:4700::1", family: 6 }];
        throw new Error(`unexpected hostname ${hostname}`);
      },
    };
    await expect(assertWebhookTargetAllowed(new URL("http://mixed.test/x"), policy)).rejects.toThrow(/resolves to private or special-use/);
    await expect(assertWebhookTargetAllowed(new URL("http://rebind.test/x"), policy)).rejects.toThrow(/resolves to private or special-use/);
    const resolved = await resolveWebhookTarget(new URL("http://public.test/x"), policy);
    expect(resolved.addresses).toEqual(["1.1.1.1", "2606:4700::1"]);
  });

  test("resolves lookup failures to a rejection rather than a pass", async () => {
    const policy: WebhookTargetPolicy = {
      lookup: async () => {
        throw new Error("ENOTFOUND probe.test");
      },
    };
    await expect(assertWebhookTargetAllowed(new URL("http://probe.test/x"), policy)).rejects.toThrow(/could not be resolved/);
  });

  test("admits only allowlisted private targets for intentional private ingress", async () => {
    const loopback: WebhookTargetPolicy = { allowPrivateHosts: ["127.0.0.1"] };
    await expect(assertWebhookTargetAllowed(new URL("http://127.0.0.1:8080/x"), loopback)).resolves.toBeUndefined();
    await expect(assertWebhookTargetAllowed(new URL("http://127.0.0.2:8080/x"), loopback)).rejects.toThrow(/private or special-use/);

    const hostnamePolicy: WebhookTargetPolicy = {
      allowPrivateHosts: ["receiver.internal"],
      lookup: async (hostname) => hostname === "receiver.internal"
        ? [{ address: "10.0.0.7", family: 4 }]
        : [{ address: "192.168.1.9", family: 4 }],
    };
    await expect(assertWebhookTargetAllowed(new URL("http://receiver.internal/x"), hostnamePolicy)).resolves.toBeUndefined();
    await expect(assertWebhookTargetAllowed(new URL("http://other.internal/x"), hostnamePolicy)).rejects.toThrow(/resolves to private or special-use/);
  });

  test("dispatchWebhook refuses a private target before any connection", async () => {
    const event = createEvent({ id: "ssrf-private", source: "notes", type: "note.created" });
    const attempt = await dispatchWebhook(event, {
      id: "private",
      enabled: true,
      transport: "webhook",
      webhook: { url: "http://10.0.0.5/hook" },
      createdAt: event.time,
      updatedAt: event.time,
    }, { webhookTargetPolicy: {} });
    expect(attempt.status).toBe("failed");
    expect(attempt.error).toMatch(/private or special-use/);
  });

  test("dispatchWebhook pins the connection to the validated address, closing the rebinding window", async () => {
    let fetchedUrl: string | undefined;
    let hostHeader: string | undefined;
    const policy: WebhookTargetPolicy = {
      lookup: async (hostname) => {
        expect(hostname).toBe("receiver.test");
        // The rebinding attack: system DNS changes to a private address after
        // validation. The guard must connect to the validated public address.
        return [{ address: "1.1.1.1", family: 4 }];
      },
    };
    const attempt = await dispatchWebhook(createEvent({ id: "ssrf-pin", source: "notes", type: "note.created" }), {
      id: "pinned",
      enabled: true,
      transport: "webhook",
      webhook: { url: "http://receiver.test/hook" },
      createdAt: "2026-08-06T10:00:00.000Z",
      updatedAt: "2026-08-06T10:00:00.000Z",
    }, {
      webhookTargetPolicy: policy,
      fetchImpl: async (input) => {
        fetchedUrl = typeof input === "string" ? input : String(input);
        hostHeader = new Headers({ host: "receiver.test" }).get("host") ?? undefined;
        return new Response("queued", { status: 202 });
      },
    });
    expect(attempt.status).toBe("success");
    expect(fetchedUrl).toContain("1.1.1.1");
    expect(fetchedUrl).not.toContain("receiver.test");
  });

  test("dispatchWebhook revalidates every redirect hop and refuses a redirect to a private target", async () => {
    const event = createEvent({ id: "ssrf-redirect", source: "notes", type: "note.created" });
    const policy: WebhookTargetPolicy = {
      lookup: async (hostname) => {
        if (hostname === "receiver.test") return [{ address: "1.1.1.1", family: 4 }];
        throw new Error(`unexpected hostname ${hostname}`);
      },
    };
    let fetchCount = 0;
    const attempt = await dispatchWebhook(event, {
      id: "redirect",
      enabled: true,
      transport: "webhook",
      webhook: { url: "http://receiver.test/hook" },
      createdAt: event.time,
      updatedAt: event.time,
    }, {
      webhookTargetPolicy: policy,
      fetchImpl: async (_input, init) => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response(null, { status: 302, headers: { location: "http://10.0.0.9/private" } });
        }
        throw new Error("should not reach the redirected hop");
      },
    });
    expect(fetchCount).toBe(1);
    expect(attempt.status).toBe("failed");
    expect(attempt.error).toMatch(/private or special-use/);
  });

  test("dispatchWebhook follows a redirect to a public target and delivers", async () => {
    const event = createEvent({ id: "ssrf-public-redirect", source: "notes", type: "note.created" });
    const policy: WebhookTargetPolicy = {
      lookup: async (hostname) => {
        if (hostname === "receiver.test") return [{ address: "1.1.1.1", family: 4 }];
        if (hostname === "final.test") return [{ address: "8.8.8.8", family: 4 }];
        throw new Error(`unexpected hostname ${hostname}`);
      },
    };
    let fetchCount = 0;
    const attempt = await dispatchWebhook(event, {
      id: "public-redirect",
      enabled: true,
      transport: "webhook",
      webhook: { url: "http://receiver.test/hook" },
      createdAt: event.time,
      updatedAt: event.time,
    }, {
      webhookTargetPolicy: policy,
      fetchImpl: async (_input, init) => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response(null, { status: 307, headers: { location: "http://final.test/hook" } });
        }
        expect(init?.method ?? "POST").toBe("POST");
        return new Response("queued", { status: 202 });
      },
    });
    expect(fetchCount).toBe(2);
    expect(attempt.status).toBe("success");
  });
});
