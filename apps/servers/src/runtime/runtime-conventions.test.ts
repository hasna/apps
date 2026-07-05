import { describe, expect, it } from "bun:test";
import {
  resolveServerRuntimeConvention,
  runtimeMetadataFromConvention,
} from "./runtime-conventions.js";

describe("server runtime conventions", () => {
  it("describes local runtime as process-managed by @hasna/servers", () => {
    const convention = resolveServerRuntimeConvention({
      port: 3042,
      env: {},
    });

    expect(convention.mode).toBe("local");
    expect(convention.processOwner).toBe("hasna-servers");
    expect(convention.canManageProcess).toBe(true);
    expect(convention.bindHost).toBe("127.0.0.1");
    expect(convention.probeHost).toBe("127.0.0.1");
    expect(convention.healthPath).toBe("/health");
    expect(convention.readinessPath).toBe("/ready");
    expect(convention.healthUrl).toBe("http://127.0.0.1:3042/health");
    expect(convention.readinessUrl).toBe("http://127.0.0.1:3042/ready");

    expect(runtimeMetadataFromConvention(convention)).toMatchObject({
      runtime_mode: "local",
      process_owner: "hasna-servers",
      bind_host: "127.0.0.1",
      health_path: "/health",
      readiness_path: "/ready",
      port: 3042,
    });
  });

  it("describes production cloud-backed runtime as externally process-managed", () => {
    const convention = resolveServerRuntimeConvention({
      mode: "production",
      env: {
        PORT: "8080",
        SERVERS_PUBLIC_URL: "https://api.example.test",
        SERVERS_HEALTH_PATH: "healthz",
        SERVERS_READINESS_PATH: "readyz",
      },
    });

    expect(convention.mode).toBe("production-cloud");
    expect(convention.processOwner).toBe("external-platform");
    expect(convention.canManageProcess).toBe(false);
    expect(convention.bindHost).toBe("0.0.0.0");
    expect(convention.healthPath).toBe("/healthz");
    expect(convention.readinessPath).toBe("/readyz");
    expect(convention.healthUrl).toBe("http://127.0.0.1:8080/healthz");
    expect(convention.readinessUrl).toBe("http://127.0.0.1:8080/readyz");
    expect(convention.publicUrl).toBe("https://api.example.test");
  });

  it("preserves explicit endpoint URLs and rejects unknown runtime modes", () => {
    const convention = resolveServerRuntimeConvention({
      metadata: {
        runtime_mode: "production-cloud",
        port: 9090,
        health_url: "https://internal.example.test/status",
        readiness_url: "https://internal.example.test/ready",
      },
      env: {
        PORT: "8080",
      },
    });

    expect(convention.port).toBe(9090);
    expect(convention.healthUrl).toBe("https://internal.example.test/status");
    expect(convention.readinessUrl).toBe("https://internal.example.test/ready");
    expect(() => resolveServerRuntimeConvention({ mode: "staging-fleet" })).toThrow("Unsupported server runtime mode");
  });
});
