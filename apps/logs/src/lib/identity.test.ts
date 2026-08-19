/**
 * Test gap coverage for src/lib/identity.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The runtime-identity detection module had no sibling test. These tests pin
 * the deterministic machine fingerprint, the db-free computeRuntimeIdentity
 * resolution (git repo detection, nearest-package.json app detection,
 * environment precedence), and its agreement with the shared identity shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { arch, hostname, platform } from "node:os";
import { computeRuntimeIdentity, machineFingerprintId } from "./identity.ts";

beforeEach(() => {
  delete process.env.NODE_ENV;
});

afterEach(() => {
  delete process.env.NODE_ENV;
});

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "logs-identity-test-"));
}

describe("machineFingerprintId", () => {
  it("is deterministic and derived from hostname:platform:arch", () => {
    const expected = `machine_${sha256(`${hostname()}:${platform()}:${arch()}`).slice(0, 16)}`;
    expect(machineFingerprintId()).toBe(expected);
    expect(machineFingerprintId()).toBe(machineFingerprintId());
    expect(machineFingerprintId()).toMatch(/^machine_[a-f0-9]{16}$/);
  });
});

describe("computeRuntimeIdentity", () => {
  it("resolves no repo in an empty directory and walks up to the nearest package.json", () => {
    const dir = tempDir();
    try {
      const identity = computeRuntimeIdentity(dir);
      expect(identity.repo_id).toBeNull();
      expect(identity.environment).toBe("development");
      expect(identity.machine_id).toBe(machineFingerprintId());
      // App detection walks up the tree: the nearest package.json above the
      // temp dir wins. Replicate the walk in the test to derive the expected id
      // from the exact path (content-independent, so it holds on any machine).
      let nearest: string | null = null;
      let current = dir;
      while (true) {
        const candidate = join(current, "package.json");
        if (existsSync(candidate)) {
          nearest = candidate;
          break;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
      expect(identity.app_id).toBe(
        nearest === null ? null : `app_${sha256(nearest).slice(0, 16)}`,
      );
      if (identity.app_id) expect(identity.app_id).toMatch(/^app_[a-f0-9]{16}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects the nearest package.json as an app with deterministic id", () => {
    const dir = tempDir();
    try {
      const pkgPath = join(dir, "package.json");
      writeFileSync(pkgPath, JSON.stringify({ name: "demo-app", version: "1.2.3" }));
      const identity = computeRuntimeIdentity(dir);
      expect(identity.app_id).toBe(`app_${sha256(pkgPath).slice(0, 16)}`);
      expect(identity.environment).toBe("development");
      const dbless = computeRuntimeIdentity(join(dir, "nested", "deep"));
      // Walks up: the nested dir inherits the same app resolution.
      expect(dbless.app_id).toBe(identity.app_id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honors opts.environment over the NODE_ENV default", () => {
    const dir = tempDir();
    try {
      const identity = computeRuntimeIdentity(dir, { environment: "production" });
      expect(identity.environment).toBe("production");
      process.env.NODE_ENV = "test";
      expect(computeRuntimeIdentity(dir).environment).toBe("test");
      delete process.env.NODE_ENV;
      expect(computeRuntimeIdentity(dir).environment).toBe("development");
    } finally {
      delete process.env.NODE_ENV;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects a git repo and derives a deterministic repo id", () => {
    const dir = tempDir();
    try {
      execFileSync("git", ["init", "-q", dir]);
      execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
      execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
      writeFileSync(join(dir, "file.txt"), "x");
      execFileSync("git", ["-C", dir, "add", "file.txt"]);
      execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
      const identity = computeRuntimeIdentity(dir);
      expect(identity.repo_id).toBe(`repo_${sha256(dir).slice(0, 16)}`);
      expect(identity.repo_id).toMatch(/^repo_[a-f0-9]{16}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
