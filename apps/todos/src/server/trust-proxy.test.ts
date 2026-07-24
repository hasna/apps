import { afterEach, describe, expect, test } from "bun:test";
import { resolveClientIp, resolveStartServerOptions } from "./serve.js";

const originalTrustProxy = process.env.TODOS_TRUST_PROXY;

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.TODOS_TRUST_PROXY;
  else process.env.TODOS_TRUST_PROXY = originalTrustProxy;
});

function requestWithForwarded(address: string): Request {
  return new Request("http://todos.test/health", {
    headers: {
      "x-forwarded-for": address,
      "x-real-ip": "198.51.100.99",
    },
  });
}

const peerServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
};

describe("startup trust-proxy policy", () => {
  test("an enabled startup snapshot remains enabled after caller and process env mutation", () => {
    const environment = {
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
      TODOS_TRUST_PROXY: "true",
    } as NodeJS.ProcessEnv;
    const resolved = resolveStartServerOptions({ open: false, environment });
    expect(resolved.trustProxy).toBe(true);

    environment.TODOS_TRUST_PROXY = "0";
    process.env.TODOS_TRUST_PROXY = "0";
    expect(resolveClientIp(requestWithForwarded("203.0.113.8"), peerServer, resolved.trustProxy))
      .toBe("203.0.113.8");
  });

  test("a disabled startup snapshot cannot be enabled by a later process env mutation", () => {
    const environment = {
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
      TODOS_TRUST_PROXY: "0",
    } as NodeJS.ProcessEnv;
    const resolved = resolveStartServerOptions({ open: false, environment });
    expect(resolved.trustProxy).toBe(false);

    environment.TODOS_TRUST_PROXY = "true";
    process.env.TODOS_TRUST_PROXY = "true";
    expect(resolveClientIp(requestWithForwarded("203.0.113.9"), peerServer, resolved.trustProxy))
      .toBe("127.0.0.1");
  });
});
