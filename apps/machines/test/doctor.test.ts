import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { doctorExitCode, runDoctor, type DoctorAdapter } from "../src/commands/doctor.js";
import { getDataDir } from "../src/paths.js";

describe("doctor", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_DB_PATH"];
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
    delete process.env["HASNA_MACHINES_PRIVATE_MANIFEST_REF"];
    delete process.env["MACHINES_PRIVATE_MANIFEST_REF"];
    delete process.env["HASNA_GITHUB_APP_ID"];
    delete process.env["HASNA_GITHUB_APP_PRIVATE_KEY_REF"];
  });

  test("reports local machine checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    manifestInit();
    manifestAdd({ id: "demo-node-01", platform: "linux", workspacePath: "/home/operator/workspace" });
    writeFileSync(process.env["HASNA_MACHINES_DB_PATH"]!, "", "utf8");
    writeFileSync(process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"]!, "{}", "utf8");

    const report = runDoctor("demo-node-01");
    expect(report.machineId).toBe("demo-node-01");
    expect(report.checks.some((check) => check.id === "bun")).toBe(true);
    expect(report.checks.some((check) => check.id === "manifest-entry" && check.status === "ok")).toBe(true);
    expect(report.checks.some((check) => check.id === "secrets-adapter" && check.optional === true)).toBe(true);
    expect(report.checks.some((check) => check.id === "sudo-noninteractive")).toBe(true);
    expect(report.checks.some((check) => check.id === "ssh-cert-support")).toBe(true);
    expect(report.checks.some((check) => check.id === "github-app-auth")).toBe(true);
  });

  test("doctor data_dir default is not single-quote-wrapped (P4 wave review P1 regression)", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-quoting-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    delete process.env["HASNA_MACHINES_DIR"];
    manifestInit();
    manifestAdd({ id: "demo-node-01", platform: "linux", workspacePath: "/home/operator/workspace" });
    writeFileSync(process.env["HASNA_MACHINES_DB_PATH"]!, "", "utf8");
    writeFileSync(process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"]!, "{}", "utf8");

    let captured = "";
    runDoctor("demo-node-01", {
      commandRunner: (machineId, command) => {
        captured = command;
        return { machineId, source: "local", stdout: "", stderr: "", exitCode: 0 };
      },
    });

    // A `'` immediately after `:-` inside the double-quoted ${...:-...} expansion
    // becomes a literal character of the expanded value, not quoting — breaking
    // every derived path ($data_dir/machines.json & co) and its test -e probe.
    expect(captured).not.toMatch(/\$\{HASNA_MACHINES_DIR:\s*'/);
    expect(captured).toContain(`data_dir="\${HASNA_MACHINES_DIR:-${getDataDir()}}"`);
  });

  test("reports GitHub App references without leaking values", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-github-app-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_GITHUB_APP_ID"] = "12345";
    process.env["HASNA_GITHUB_APP_PRIVATE_KEY_REF"] = "secrets://github-app/private-key";
    manifestInit();
    manifestAdd({ id: "demo-node-01", platform: "linux", workspacePath: "/workspace" });

    const report = runDoctor("demo-node-01");
    const check = report.checks.find((entry) => entry.id === "github-app-auth");

    expect(check?.data).toMatchObject({ app_ref_configured: true });
    expect(JSON.stringify(report)).not.toContain("12345");
    expect(JSON.stringify(report)).not.toContain("secrets://github-app/private-key");
  });

  test("does not expose inferred local machine id in default JSON report", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-implicit-local-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "private-host-real";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();

    const missingReport = runDoctor();
    expect(missingReport.machineId).toBe("local");
    expect(JSON.stringify(missingReport)).not.toContain("private-host-real");
    expect(missingReport.checks.find((check) => check.id === "manifest-entry")?.detail).toBe("No manifest entry for local");

    manifestAdd({ id: "private-host-real", platform: "linux", workspacePath: "/home/operator/workspace" });
    const declaredReport = runDoctor();
    const payload = JSON.stringify(declaredReport);

    expect(declaredReport.machineId).toBe("local");
    expect(payload).not.toContain("private-host-real");
    expect(declaredReport.checks.find((check) => check.id === "manifest-entry")?.status).toBe("ok");
  });

  test("marks remote checks unverified when an unmanaged machine probe fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-unmanaged-remote-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();

    const report = runDoctor("topology-only-fixture", {
      includeOptionalAdapters: false,
      commandRunner: (machineId) => ({
        machineId,
        source: "tailscale",
        stdout: "",
        stderr: "remote probe unavailable",
        exitCode: 255,
      }),
    });
    expect(report.source).toBe("tailscale");
    expect(report.probe).toMatchObject({
      attempted: true,
      verified: false,
      exitCode: 255,
      reason: "command_failed",
      source: "tailscale",
    });
    expect(doctorExitCode(report)).toBe(1);
    expect(report.checks.find((check) => check.id === "manifest-entry")).toMatchObject({
      status: "warn",
      data: { declared: false },
    });
    expect(report.checks.find((check) => check.id === "command-probe")).toMatchObject({
      status: "warn",
      data: { verified: false, exitCode: 255 },
    });

    for (const id of [
      "data-dir",
      "manifest-path",
      "db-path",
      "notifications-path",
      "bun",
      "machines-cli",
      "machines-daemon-cli",
      "machines-mcp-cli",
      "ssh",
      "sudo-noninteractive",
      "ssh-cert-support",
      "github-app-auth",
    ]) {
      const check = report.checks.find((entry) => entry.id === id);
      expect(check, id).toMatchObject({
        status: "warn",
        data: { verified: false },
      });
      expect(check?.detail, id).toContain("Unverified");
      expect(check?.detail.toLowerCase(), id).not.toContain("missing");
    }
  });

  test("redacts manifest and adapter details in JSON output", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-redact-"));
    const secretToken = `gh${"p"}_${"PRIVATE".repeat(5)}`;
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    process.env["HASNA_MACHINES_PRIVATE_MANIFEST_REF"] = "vault://private-fleet/prod/operator-hosts";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      hostname: "prod-mac-real.local",
      sshAddress: "alice@prod-mac-real.local",
      tailscaleName: "prod-mac-real.tailnet.example",
      platform: "linux",
      workspacePath: "/home/alice/workspace",
      metadata: {
        user: "alice",
        api_token: secretToken,
        githubAppPrivateKey: "synthetic-private-key-material",
        workspace_paths: {
          project: "/home/alice/workspace/project",
        },
      },
    });

    const adapter: DoctorAdapter = {
      id: "fixture",
      checks: {
        secrets: () => ({
          id: "vault",
          status: "ok",
          summary: "Secrets adapter",
          detail: `checked ${secretToken}`,
          data: {
            token: secretToken,
            privateKey: "synthetic-private-key-material",
            secretRef: "machines/screen-sharing/demo",
          },
        }),
      },
    };

    const report = runDoctor("demo-node-01", {
      now: new Date("2026-06-17T00:00:00.000Z"),
      adapters: [adapter],
    });
    const payload = JSON.stringify(report);

    expect(report.manifestSource?.loadedFrom).toBe("fallback");
    expect(report.checks.find((check) => check.id === "manifest-source")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "secrets:vault")?.source).toBe("adapter:fixture");
    expect(payload).not.toContain("prod-mac-real.local");
    expect(payload).not.toContain("alice@");
    expect(payload).not.toContain("/home/alice");
    expect(payload).not.toContain("private-fleet");
    expect(payload).not.toContain("operator-hosts");
    expect(payload).not.toContain(secretToken);
    expect(payload).not.toContain("private-material");
    expect(payload).toContain("/home/<user>/workspace");
    expect(payload).toContain("machines/screen-sharing/demo");
  });

  test("reports optional adapter fallback checks when no adapters are configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-adapter-fallback-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    manifestInit();
    manifestAdd({ id: "demo-node-01", platform: "linux", workspacePath: "/workspace" });

    const report = runDoctor("demo-node-01");
    for (const domain of ["secrets", "configs", "monitor", "repos", "mcps", "shield"]) {
      expect(report.checks).toContainEqual(expect.objectContaining({
        id: `${domain}-adapter`,
        status: "ok",
        optional: true,
        data: { configured: false, fallback: true },
      }));
    }
  });

  test("hides raw private refs from manifest and optional adapter failures", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-private-adapter-"));
    const rawPrivateRef = "s3://private-fleet.example/demo/machines.json?token=github_pat_123456789012345678901234";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-04";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_PRIVATE_MANIFEST_REF"] = rawPrivateRef;
    manifestInit();

    const report = runDoctor("demo-node-04", {
      manifestAdapter: {
        id: "demo/private-adapter",
        readManifest() {
          throw new Error(`cannot read ${rawPrivateRef}`);
        },
      },
      adapters: [
        {
          id: "private/secrets-adapter",
          checks: {
            secrets() {
              throw new Error(`failed ${rawPrivateRef}`);
            },
            configs() {
              return {
                id: "baseline",
                status: "warn",
                summary: "Config baseline",
                detail: "config at /home/operator/private/config.json drifted",
                data: {
                  token: "github_pat_123456789012345678901234",
                  path: "/home/operator/private/config.json",
                },
              };
            },
          },
        },
      ],
    });
    const payload = JSON.stringify(report);

    expect(report.manifestSource?.source.ref).toBe("s3://<redacted>");
    expect(payload).not.toContain(rawPrivateRef);
    expect(payload).not.toContain("github_pat_123456789012345678901234");
    expect(payload).not.toContain("/home/operator");
    expect(payload).toContain("private_manifest_adapter_failed:demo_private-adapter");
    expect(payload).toContain("Adapter failed; details are intentionally hidden");
    expect(payload).toContain("/home/<user>");
  });
});
