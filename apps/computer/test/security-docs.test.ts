import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const securityDoc = readFileSync("docs/security-control-plane.md", "utf8");
const remoteTransportDoc = readFileSync("docs/secure-remote-transport.md", "utf8");
const fleetControlDoc = readFileSync("docs/fleet-control.md", "utf8");
const nonDestructiveMachinePlan = readFileSync("docs/non-destructive-machine-validation.md", "utf8");
const releaseVerifier = readFileSync("scripts/verify-release.ts", "utf8");
const readme = readFileSync("README.md", "utf8");

describe("security control-plane documentation", () => {
  test("maps high-risk capabilities to owners, auth, and approval policy", () => {
    expect(securityDoc).toContain("| Capability | Owner | Transport or Entry | Default State | Auth Requirement | Approval and Policy |");
    for (const capability of [
      "computer.screenshot",
      "computer.type",
      "terminal.exec",
      "browser.navigate",
      "fleet.run_smoke",
      "storage.sync",
      "computer.run_task",
      "computer.pause_session",
      "computer.resume_session",
      "computer.emergency_stop",
      "provider.analyze",
    ]) {
      expect(securityDoc).toContain(capability);
    }
    for (const boundary of [
      "OS boundary",
      "Provider boundary",
      "Transport boundary",
      "Browser boundary",
      "Fleet boundary",
      "Storage boundary",
      "Runtime boundary",
    ]) {
      expect(securityDoc).toContain(boundary);
    }
  });

  test("release verifier packages the control-plane threat model", () => {
    expect(releaseVerifier).toContain("package/docs/security-control-plane.md");
    expect(releaseVerifier).toContain("package/docs/fleet-control.md");
  });

  test("documents secure remote transport as separate from approval", () => {
    expect(securityDoc).toContain("docs/secure-remote-transport.md");
    expect(remoteTransportDoc).toContain("approval is not a transport credential");
    expect(remoteTransportDoc).toContain("machine-scoped capability token");
    expect(remoteTransportDoc).toContain("Plain remote HTTP is blocked");
  });

  test("documents fixture-only non-destructive machine validation", () => {
    for (const required of [
      "loopback",
      "fixture_only=true",
      "external_sites=false",
      "secrets_touched=false",
      "destructive_actions=false",
      "credentials",
      "payment",
      "destructive shell commands",
      "leftovers.tabs=0",
      "leftovers.files=0",
      "leftovers.processes=0",
    ]) {
      expect(nonDestructiveMachinePlan).toContain(required);
    }
  });

  test("README documents safe browser control lane selection", () => {
    for (const required of [
      "## Browser Control Lanes",
      "Pixel computer control",
      "Browser-native control",
      "Extension engine",
      "policy-gated",
      "never auto-selected",
      "Do not use pixel control, browser-native automation, or the extension engine",
      "bypass CAPTCHA, MFA, bot detection, rate limits, paywalls, access controls",
      "Prefer official APIs",
      "computer plan",
      "browser navigate https://example.com --engine extension",
    ]) {
      expect(readme).toContain(required);
    }
    expect(readme).not.toContain("open Safari and search for 'weather in NYC'");
  });

  test("documents fleet control boundaries without private fleet state", () => {
    for (const required of [
      "# Fleet Control Contract",
      "Machine Identity",
      "Trust",
      "Routes",
      "Workspaces",
      "Display And Browser Resources",
      "Capability Surface",
      "Leases",
      "Remote Job Queue",
      "Artifact Boundary",
      "Implementation Status",
      "@hasna/machines/consumer",
      "Approval authorizes intent only",
      "Production remote job dispatch is a future adapter contract",
      "source-checkout live-machine validation remains lab-only",
      "Production remote execution adapter | Not implemented yet",
      "The package must continue to avoid a hard dependency on `@hasna/machines`",
    ]) {
      expect(fleetControlDoc).toContain(required);
    }

    for (const forbidden of [
      /machine-[a-f0-9]{10,}/i,
      /operator@/i,
      /\.tailnet\./i,
      /\.private\./i,
      /100\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
      /postgres:\/\/[^`\s]+/i,
      /\/home\/hasna/i,
    ]) {
      expect(fleetControlDoc).not.toMatch(forbidden);
    }
  });
});
