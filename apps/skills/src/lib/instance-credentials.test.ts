import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { clearAuthConfig, getAuthFilePath, getAuthIdentity, saveApiUrl, saveAuthConfig } from "./auth-store.js";
import { resolveSkillsFleet, resolveSkillsConnection } from "./fleet-credentials.js";
import { readSkillsInstanceMetadata } from "./instance-credentials.js";
import { createRemoteSkillsClient } from "./remote-client.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const root = mkdtempSync(join(tmpdir(), "skills-instance-binding-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function env(name: string) { return { HASNA_CONFIG_HOME: join(root, name), HASNA_HOME: join(root, name, "data"), HASNA_STATION: "skills-binding-no-keychain-entry" }; }

describe("Skills instance-bound profile credentials", () => {
  test("two profiles keep separate instance URLs, credentials and identities", () => {
    const base = env("profiles");
    const first = { ...base, HASNA_PROFILE: "internal" };
    const second = { ...base, HASNA_PROFILE: "commercial" };
    saveApiUrl("http://127.0.0.1:4001/prefix/api/v1", first);
    saveAuthConfig({ apiKey: "fixture-first", email: "first@example.test" }, first);
    saveApiUrl("http://127.0.0.1:4002/api/v1", second);
    saveAuthConfig({ apiKey: "fixture-second", email: "second@example.test" }, second);
    expect(getAuthFilePath(first)).not.toBe(getAuthFilePath(second));
    expect(resolveSkillsFleet(first)).toMatchObject({ apiOrigin: "http://127.0.0.1:4001/prefix", apiKey: "fixture-first" });
    expect(resolveSkillsFleet(second)).toMatchObject({ apiOrigin: "http://127.0.0.1:4002", apiKey: "fixture-second" });
    expect(getAuthIdentity(first).email).toBe("first@example.test");
    expect(getAuthIdentity(second).email).toBe("second@example.test");
    expect(statSync(getAuthFilePath(first)).mode & 0o077).toBe(0);
  });
  test("accessor-backed configuration cannot rotate a credential between URL reads", async () => {
    const base = env("snapshot");
    let reads = 0;
    const rotating = { ...base, HASNA_SKILLS_API_KEY_OVERRIDE: "fixture-before",
      get HASNA_SKILLS_API_URL() { reads++; this.HASNA_SKILLS_API_KEY_OVERRIDE = "fixture-after"; return "http://127.0.0.1:4001"; } };
    await expect(resolveSkillsConnection(rotating)).rejects.toThrow("Accessor-backed");
    expect(reads).toBe(0);
  });
  test("an atomic file replacement during shared credential resolution refuses the mixed pair", () => {
    const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "instance-credentials-race.fixture.ts")], {
      env: { PATH: process.env.PATH, HASNA_HOME: join(root, "race-child"), HASNA_STATION: "isolated-race" },
      timeout: 10_000, stdout: "pipe", stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toMatchObject({ rotated: true, refused: true });
    expect(child.stdout.toString()).not.toContain("wrongInstanceCredentialPair");
  });
  test("profile routing rejects symlinks, oversized files and unsafe permissions before credential resolution", () => {
    const base = { ...env("unsafe-metadata"), HASNA_PROFILE: "customer" };
    const path = getAuthFilePath(base);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const target = `${path}.target`;
    writeFileSync(target, "HASNA_SKILLS_API_URL=https://skills.example.test\n", { mode: 0o600 });
    symlinkSync(target, path);
    expect(() => resolveSkillsFleet(base)).toThrow("safely read");
    rmSync(path);
    writeFileSync(path, "x".repeat(64 * 1024 + 1), { mode: 0o600 });
    expect(() => readSkillsInstanceMetadata(path)).toThrow("bounded owner-only");
    rmSync(path);
    writeFileSync(path, "HASNA_SKILLS_API_URL=https://skills.example.test\n", { mode: 0o644 });
    expect(() => readSkillsInstanceMetadata(path)).toThrow("bounded owner-only");
    rmSync(path);
    if (process.platform !== "win32") {
      const fifo = Bun.spawnSync(["mkfifo", "-m", "600", path]);
      expect(fifo.exitCode).toBe(0);
      const started = performance.now();
      expect(() => readSkillsInstanceMetadata(path)).toThrow("bounded owner-only");
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
  test("a completed connection keeps its original bound pair across later profile rotation", async () => {
    const base = { ...env("rotation"), HASNA_PROFILE: "customer" };
    saveApiUrl("http://127.0.0.1:4001", base);
    saveAuthConfig({ apiKey: "fixture-before" }, base);
    const pending = resolveSkillsConnection(base);
    saveApiUrl("http://127.0.0.1:4002", base);
    saveAuthConfig({ apiKey: "fixture-after" }, base);
    expect(await pending).toMatchObject({ apiOrigin: "http://127.0.0.1:4001", apiKey: "fixture-before" });
    expect(await resolveSkillsConnection(base)).toMatchObject({ apiOrigin: "http://127.0.0.1:4002", apiKey: "fixture-after" });
  });
  test("an established default instance does not override a selected profile", () => {
    const base = env("default-plus-profile");
    saveApiUrl("http://127.0.0.1:4001", base);
    saveAuthConfig({ apiKey: "fixture-default" }, base);
    const profile = { ...base, HASNA_PROFILE: "customer" };
    saveApiUrl("http://127.0.0.1:4002/prefix/api/v1", profile);
    saveAuthConfig({ apiKey: "fixture-profile" }, profile);
    expect(resolveSkillsFleet(profile)).toMatchObject({ apiOrigin: "http://127.0.0.1:4002/prefix", apiKey: "fixture-profile" });
    expect(resolveSkillsFleet(base)).toMatchObject({ apiOrigin: "http://127.0.0.1:4001", apiKey: "fixture-default" });
  });
  test("equivalent normalized URL overrides work for default and named profiles", () => {
    for (const profile of [undefined, "customer"]) {
      const base = { ...env(`normalization-${profile ?? "default"}`), ...(profile ? { HASNA_PROFILE: profile } : {}) };
      saveApiUrl("http://127.0.0.1:4001/prefix", base);
      saveAuthConfig({ apiKey: "fixture-bound" }, base);
      expect(resolveSkillsFleet({ ...base, HASNA_SKILLS_API_URL: "http://127.0.0.1:4001/prefix/api/v1/" })).toMatchObject({ apiOrigin: "http://127.0.0.1:4001/prefix", apiKey: "fixture-bound" });
      expect(() => resolveSkillsFleet({ ...base, HASNA_SKILLS_API_URL: "http://127.0.0.1:4001", SKILLS_API_URL: "http://127.0.0.1:4002" })).toThrow();
    }
  });
  test("logout removes selected-profile aliases without touching a different profile", () => {
    const base = env("logout");
    const first = { ...base, HASNA_PROFILE: "first" };
    const second = { ...base, HASNA_PROFILE: "second" };
    saveApiUrl("http://127.0.0.1:4001", first);
    saveAuthConfig({ apiKey: "fixture-first" }, first);
    saveApiUrl("http://127.0.0.1:4002", second);
    saveAuthConfig({ apiKey: "fixture-second" }, second);
    expect(clearAuthConfig(first)).toEqual({ stillResolves: false });
    expect(clearAuthConfig(first)).toEqual({ stillResolves: false });
    expect(resolveSkillsFleet(second)).toMatchObject({ apiKey: "fixture-second" });
    expect(() => resolveSkillsFleet(first)).toThrow("has no HASNA_SKILLS_API_KEY");
  });
  test("a URL override cannot redirect a saved credential or its identity", async () => {
    const base = env("override");
    saveApiUrl("http://127.0.0.1:4001", base);
    saveAuthConfig({ apiKey: "fixture-private", email: "private@example.test" }, base);
    const changed = { ...base, HASNA_SKILLS_API_URL: "http://127.0.0.1:4002" };
    expect(() => resolveSkillsFleet(changed)).toThrow("does not match");
    await expect(createRemoteSkillsClient(changed)).rejects.toThrow("does not match");
    expect(getAuthIdentity(changed)).toEqual({});
    expect(() => resolveSkillsFleet({ ...base, HASNA_SKILLS_API_URL: "http://127.0.0.1:4001/other" })).toThrow("does not match");
  });
  test("editing an unbound legacy URL captures its OLD binding, never the replacement", () => {
    const base = env("legacy");
    const path = getAuthFilePath(base);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "HASNA_SKILLS_API_KEY=fixture-legacy\nHASNA_SKILLS_API_URL=http://127.0.0.1:4001\n", { mode: 0o600 });
    saveApiUrl("http://127.0.0.1:4002", base);
    expect(readFileSync(path, "utf8")).toContain("HASNA_SKILLS_BOUND_API_URL=http://127.0.0.1:4001");
    expect(() => resolveSkillsFleet(base)).toThrow("does not match");
    saveAuthConfig({ apiKey: "fixture-new" }, base);
    expect(resolveSkillsFleet(base)).toMatchObject({ apiOrigin: "http://127.0.0.1:4002", apiKey: "fixture-new" });
  });
  test("legacy internal defaults work, but a URL alone cannot send that key elsewhere", () => {
    const base = env("internal");
    const path = getAuthFilePath(base);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "HASNA_SKILLS_API_KEY=fixture-internal\n", { mode: 0o600 });
    expect(resolveSkillsFleet(base)).toMatchObject({ apiOrigin: "https://api.hasna.com/skills" });
    expect(() => resolveSkillsFleet({ ...base, HASNA_SKILLS_API_URL: "http://127.0.0.1:4002" })).toThrow("does not match");
  });
  test("an explicit key override forms a deliberate pair and unsafe profiles never write", () => {
    const base = env("explicit");
    expect(resolveSkillsFleet({ ...base, HASNA_SKILLS_API_URL: "http://127.0.0.1:4003", HASNA_SKILLS_API_KEY_OVERRIDE: "fixture-explicit" })).toMatchObject({ apiKeyTier: "override", apiOrigin: "http://127.0.0.1:4003" });
    for (const profile of ["", "../outside", "unsafe/name", ".", "a\nother"]) expect(() => getAuthFilePath({ ...base, HASNA_PROFILE: profile })).toThrow();
  });
});
