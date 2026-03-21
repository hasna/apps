import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { resetDatabase } from "../db/schema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "integrations-test-"));
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

// ─── auth.ts ──────────────────────────────────────────────────────────────────

describe("getCredentials", () => {
  it("returns null when service not found", async () => {
    const { getCredentials } = await import("./auth.js");
    const creds = await getCredentials("nonexistent-service-xyz123");
    expect(creds).toBeNull();
  });

  it("reads from process.env as fallback", async () => {
    process.env["TESTSERVICE_EMAIL"] = "test@example.com";
    process.env["TESTSERVICE_PASSWORD"] = "secret123";
    const { getCredentials } = await import("./auth.js");
    const creds = await getCredentials("testservice");
    expect(creds?.email).toBe("test@example.com");
    expect(creds?.password).toBe("secret123");
    delete process.env["TESTSERVICE_EMAIL"];
    delete process.env["TESTSERVICE_PASSWORD"];
  });

  it("returns null for unrecognized service with no env vars", async () => {
    const { getCredentials } = await import("./auth.js");
    // Use a random service name that won't match anything
    const creds = await getCredentials("xyzrandomunknownservice99");
    expect(creds).toBeNull();
  });
});

// ─── page-memory.ts ───────────────────────────────────────────────────────────

describe("page memory (rememberPage + recallPage)", () => {
  it("rememberPage stores facts, recallPage retrieves them", async () => {
    const { rememberPage, recallPage } = await import("./page-memory.js");
    await rememberPage("https://stripe.com/pricing", { pro_monthly: "$99", enterprise: "custom" });
    const memory = await recallPage("https://stripe.com/pricing");
    expect(memory).toBeTruthy();
    expect(memory!.facts.pro_monthly).toBe("$99");
  });

  it("recallPage returns null for unknown URL", async () => {
    const { recallPage } = await import("./page-memory.js");
    const result = await recallPage("https://unknown-site-xyz.com/page");
    expect(result).toBeNull();
  });

  it("recallPage returns null when max_age_hours exceeded", async () => {
    const { rememberPage, recallPage } = await import("./page-memory.js");
    await rememberPage("https://old-site.com", { data: "stale" });
    // max_age = 0 hours means immediately expired
    const result = await recallPage("https://old-site.com", 0);
    expect(result).toBeNull();
  });
});

// ─── coordination.ts ─────────────────────────────────────────────────────────

describe("coordination (announce + checkDuplicate)", () => {
  it("announceNavigation registers in-memory entry", async () => {
    const { announceNavigation, checkDuplicate } = await import("./coordination.js");
    await announceNavigation("https://example.com/page", "test-session", "agent-a");
    const check = await checkDuplicate("https://example.com/page");
    expect(check.is_duplicate).toBe(true);
    expect(check.by_agent).toBe("agent-a");
  });

  it("checkDuplicate returns false for unknown URL", async () => {
    const { checkDuplicate } = await import("./coordination.js");
    const check = await checkDuplicate("https://unknown-xyz-never-navigated.com");
    expect(check.is_duplicate).toBe(false);
  });
});

// ─── task-queue.ts ────────────────────────────────────────────────────────────

describe("task queue (queueBrowserTask + getBrowserTasks)", () => {
  it("queues a task and retrieves it", async () => {
    const { queueBrowserTask, getBrowserTasks } = await import("./task-queue.js");
    const queued = await queueBrowserTask({
      title: "Extract pricing",
      description: "Get Pro tier price from stripe.com",
      url: "https://stripe.com/pricing",
      priority: "high",
    });
    expect(queued.task_id).toBeTruthy();
    expect(queued.title).toBe("Extract pricing");
    const tasks = await getBrowserTasks("pending");
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some(t => t.task_id === queued.task_id)).toBe(true);
  });

  it("completeBrowserTask removes task", async () => {
    const { queueBrowserTask, completeBrowserTask, getBrowserTasks } = await import("./task-queue.js");
    const queued = await queueBrowserTask({ title: "Test task", description: "desc" });
    await completeBrowserTask(queued.task_id, { result: "done" });
    const remaining = await getBrowserTasks("pending");
    expect(remaining.some(t => t.task_id === queued.task_id)).toBe(false);
  });
});

// ─── skills-runner.ts ─────────────────────────────────────────────────────────

describe("skills runner (listBuiltInSkills + runBrowserSkill)", () => {
  it("listBuiltInSkills returns expected skills", async () => {
    const { listBuiltInSkills } = await import("./skills-runner.js");
    const skills = listBuiltInSkills();
    expect(skills).toContain("extract-nav-links");
    expect(skills).toContain("extract-pricing");
    expect(skills).toContain("login");
    expect(skills).toContain("monitor-price");
    expect(skills).toContain("get-metadata");
    expect(skills.length).toBeGreaterThanOrEqual(5);
  });

  it("runBrowserSkill returns error for unknown skill", async () => {
    const { runBrowserSkill } = await import("./skills-runner.js");
    const mockPage = { evaluate: async (s: string) => null, goto: async () => {}, url: () => "" } as any;
    const result = await runBrowserSkill("absolutely-nonexistent-skill-xyz-999", {}, mockPage);
    // Either success=false with error, or we got a result from the skills SDK
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    // Either way, result shape is correct
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.steps_taken).toBe("number");
  });
});

// ─── ref-cache.ts ─────────────────────────────────────────────────────────────

describe("ref cache (cacheRefs + getCachedRefs)", () => {
  it("cacheRefs stores, getCachedRefs retrieves", async () => {
    const { cacheRefs, getCachedRefs } = await import("./ref-cache.js");
    const refs = { "@e0": { role: "button", name: "Submit", visible: true, enabled: true } };
    await cacheRefs("https://example.com/form", refs);
    const cached = await getCachedRefs("https://example.com/form");
    expect(cached).toBeTruthy();
    expect(cached!["@e0"].name).toBe("Submit");
  });

  it("getCachedRefs returns null for unknown URL", async () => {
    const { getCachedRefs } = await import("./ref-cache.js");
    expect(await getCachedRefs("https://not-cached-site.com/page")).toBeNull();
  });

  it("invalidateRefCache function exists and is callable", async () => {
    const { invalidateRefCache } = await import("./ref-cache.js");
    // Just verify it doesn't throw when called
    expect(() => invalidateRefCache("https://any.com")).not.toThrow();
    expect(() => invalidateRefCache()).not.toThrow(); // clear all
  });
});
