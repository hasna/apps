/**
 * Tests for auth-flow recording (src/lib/auth-flow.ts): DB-backed CRUD
 * against the temp database, plus the URL-pattern auth-page detection that
 * decides whether a recorded login should be replayed.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "../db/schema.js";
import {
  saveAuthFlow,
  getAuthFlow,
  getAuthFlowByName,
  getAuthFlowByDomain,
  listAuthFlows,
  deleteAuthFlow,
  touchAuthFlow,
  isAuthPage,
  isAuthRedirect,
} from "./auth-flow.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "auth-flow-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("auth flow CRUD", () => {
  it("saves an auth flow and reads it back with defaults", () => {
    const flow = saveAuthFlow({ name: "work-portal", domain: "portal.example.com" });
    expect(flow.id).toBeTruthy();
    expect(flow.name).toBe("work-portal");
    expect(flow.domain).toBe("portal.example.com");
    expect(flow.recording_id).toBeNull();
    expect(flow.storage_state_path).toBeNull();
    expect(flow.last_used).toBeNull();
    expect(flow.created_at).toBeTruthy();

    const fetched = getAuthFlow(flow.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("work-portal");
  });

  it("persists optional recording and storage-state references", () => {
    // recording_id is FK-constrained to the recordings table — create a real one
    const { createRecording } = require("../db/recordings.js") as typeof import("../db/recordings.js");
    const recording = createRecording({ name: "flow-rec", steps: [] });
    const flow = saveAuthFlow({
      name: "sso",
      domain: "sso.example.com",
      recordingId: recording.id,
      storageStatePath: "storage-state:sso-state.json",
    });
    expect(getAuthFlow(flow.id)?.recording_id).toBe(recording.id);
    expect(getAuthFlow(flow.id)?.storage_state_path).toBe("storage-state:sso-state.json");
  });

  it("looks a flow up by name", () => {
    saveAuthFlow({ name: "portal-a", domain: "a.example.com" });
    expect(getAuthFlowByName("portal-a")?.domain).toBe("a.example.com");
    expect(getAuthFlowByName("nope")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(getAuthFlow("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("getAuthFlowByDomain prefers the most recently used flow for a domain", () => {
    const first = saveAuthFlow({ name: "portal-old", domain: "portal.example.com" });
    const second = saveAuthFlow({ name: "portal-new", domain: "portal.example.com" });
    touchAuthFlow(second.id);
    const picked = getAuthFlowByDomain("portal.example.com");
    expect(picked?.id).toBe(second.id);
    expect(first.id).not.toBe(second.id);
  });

  it("returns null for a domain with no flow", () => {
    expect(getAuthFlowByDomain("missing.example.com")).toBeNull();
  });

  it("lists all flows, most recently used first", () => {
    const a = saveAuthFlow({ name: "flow-a", domain: "a.example.com" });
    const b = saveAuthFlow({ name: "flow-b", domain: "b.example.com" });
    touchAuthFlow(b.id);
    const all = listAuthFlows();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe("flow-b");
    expect(all[1].name).toBe("flow-a");
    expect(all[0].last_used).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("deletes a flow by name and reports whether it existed", () => {
    saveAuthFlow({ name: "doomed", domain: "doomed.example.com" });
    expect(deleteAuthFlow("doomed")).toBe(true);
    expect(deleteAuthFlow("doomed")).toBe(false);
    expect(getAuthFlowByName("doomed")).toBeNull();
  });

  it("touchAuthFlow records last_used for replay accounting", () => {
    const flow = saveAuthFlow({ name: "touch-me", domain: "touch.example.com" });
    expect(flow.last_used).toBeNull();
    touchAuthFlow(flow.id);
    expect(getAuthFlow(flow.id)?.last_used).toBeTruthy();
  });
});

describe("auth page detection", () => {
  it("recognizes login/signin/auth/sso/oauth URL shapes", () => {
    const authUrls = [
      "https://example.com/login",
      "https://example.com/signin",
      "https://example.com/sign-in",
      "https://example.com/auth/callback",
      "https://example.com/sso",
      "https://example.com/oauth/authorize",
      "https://example.com/cas/login",
      "https://accounts.google.com/signin/v2",
      "https://login.microsoftonline.com/common",
      "https://github.com/login",
      "https://auth0.com/authorize",
    ];
    for (const url of authUrls) {
      expect(isAuthPage(url), url).toBe(true);
    }
  });

  it("does not flag ordinary pages", () => {
    const normalUrls = [
      "https://example.com/",
      "https://example.com/home",
      "https://example.com/pricing",
      "https://example.com/about-us",
      "https://example.com/dashboard/overview",
    ];
    for (const url of normalUrls) {
      expect(isAuthPage(url), url).toBe(false);
    }
  });

  it("detects redirects INTO auth pages but not away or self-redirects", () => {
    expect(isAuthRedirect("https://example.com/", "https://example.com/login")).toBe(true);
    expect(isAuthRedirect("https://example.com/dashboard", "https://accounts.google.com/")).toBe(true);
    expect(isAuthRedirect("https://example.com/login", "https://example.com/dashboard")).toBe(false);
    expect(isAuthRedirect("https://example.com/login", "https://example.com/login")).toBe(false);
    expect(isAuthRedirect("https://example.com/", "https://example.com/")).toBe(false);
  });
});
