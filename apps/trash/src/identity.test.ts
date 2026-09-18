import { expect, test } from "bun:test";
import { detectAgent, detectStation } from "./identity.js";

test("station detection uses the Tailscale station name when the OS hostname is generic", () => {
  expect(detectStation({ env: {}, hostname: () => "Mac", tailscale: () => ({ HostName: "station04", DNSName: "station04.example.ts.net." }) }))
    .toEqual({ name: "station04", hostname: "Mac", source: "tailscale", platform: process.platform, architecture: process.arch });
});

test("explicit station identity wins and malformed configuration never falls back", () => {
  expect(detectStation({ env: { HASNA_STATION: "station06" }, hostname: () => "Mac", tailscale: () => { throw new Error("must not run"); } }).source).toBe("environment");
  expect(() => detectStation({ env: { HASNA_STATION: "../../another-station" }, hostname: () => "Mac" })).toThrow(/station/);
});

test("Tailscale administrative DNS names take precedence over generic device hostnames", () => {
  expect(detectStation({ env: {}, hostname: () => "Mac", tailscale: () => ({ HostName: "Mac", DNSName: "station04.example.ts.net." }) }).name).toBe("station04");
  expect(detectStation({ env: {}, hostname: () => "Mac", tailscale: () => ({ HostName: "station04", DNSName: "invalid/name.example.ts.net." }) }).name).toBe("station04");
});

test("offline detection has an explicit hostname source, never a guessed fleet alias", () => {
  const value = detectStation({ env: {}, hostname: () => "Mac.local", tailscale: () => null });
  expect(value.name).toBe("mac");
  expect(value.hostname).toBe("Mac.local");
  expect(value.source).toBe("hostname");
});

test("agent provenance is bounded and contains only named identity fields", () => {
  const env = { TODOS_AGENT_ID: "hortensiatrash0617", CODEX_THREAD_ID: "fixture-session", HASNA_TRASH_API_KEY: "fixture-not-a-real-key" };
  expect(detectAgent(env)).toEqual({ name: "hortensiatrash0617", harness: "codex", session: "fixture-session" });
  expect(JSON.stringify(detectAgent(env))).not.toContain("fixture-not-a-real-key");
  expect(() => detectAgent({}, "bad\nidentity")).toThrow(/agent/);
  expect(() => detectAgent({}, "x".repeat(129))).toThrow(/agent/);
});

test("unidentified callers are labelled honestly", () => {
  expect(detectAgent({})).toEqual({ name: "unknown", harness: null, session: null });
});
