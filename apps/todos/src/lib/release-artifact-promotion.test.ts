import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withVerifiedArtifactPromotion } from "./release-artifact-promotion.js";

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("verified release artifact promotion", () => {
  test("restores the exact prior artifacts when a late gate fails", () => {
    const fixture = mkdtempSync(join(tmpdir(), "todos-release-promotion-"));
    const root = join(fixture, "repository");
    const source = join(fixture, "verified");
    try {
      write(join(root, "dist", "release-provenance.json"), "prior-provenance\n");
      write(join(root, "dist", "server", "index.js"), "prior-server\n");
      write(join(root, "dashboard", "dist", "index.html"), "prior-dashboard\n");
      write(join(source, "dist", "release-provenance.json"), "verified-provenance\n");
      write(join(source, "dist", "server", "index.js"), "verified-server\n");
      write(join(source, "dashboard", "dist", "index.html"), "verified-dashboard\n");

      expect(() => withVerifiedArtifactPromotion(root, source, ["dist", "dashboard/dist"], () => {
        expect(readFileSync(join(root, "dist", "server", "index.js"), "utf8")).toBe("verified-server\n");
        expect(readFileSync(join(root, "dashboard", "dist", "index.html"), "utf8")).toBe("verified-dashboard\n");
        throw new Error("late pack verification failed");
      })).toThrow("late pack verification failed");

      expect(readFileSync(join(root, "dist", "release-provenance.json"), "utf8")).toBe("prior-provenance\n");
      expect(readFileSync(join(root, "dist", "server", "index.js"), "utf8")).toBe("prior-server\n");
      expect(readFileSync(join(root, "dashboard", "dist", "index.html"), "utf8")).toBe("prior-dashboard\n");
      expect(readdirSync(fixture).filter((entry) => entry.startsWith(".todos-release-rollback-"))).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("retains promoted artifacts only after all late gates pass", () => {
    const fixture = mkdtempSync(join(tmpdir(), "todos-release-promotion-"));
    const root = join(fixture, "repository");
    const source = join(fixture, "verified");
    try {
      write(join(root, "dist", "old.txt"), "old\n");
      write(join(source, "dist", "new.txt"), "new\n");
      write(join(source, "dashboard", "dist", "index.html"), "dashboard\n");

      const result = withVerifiedArtifactPromotion(root, source, ["dist", "dashboard/dist"], () => "verified");

      expect(result).toBe("verified");
      expect(existsSync(join(root, "dist", "old.txt"))).toBe(false);
      expect(readFileSync(join(root, "dist", "new.txt"), "utf8")).toBe("new\n");
      expect(readFileSync(join(root, "dashboard", "dist", "index.html"), "utf8")).toBe("dashboard\n");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("validates every verified source before moving any prior artifact", () => {
    const fixture = mkdtempSync(join(tmpdir(), "todos-release-promotion-"));
    const root = join(fixture, "repository");
    const source = join(fixture, "verified");
    try {
      write(join(root, "dist", "old.txt"), "prior-dist\n");
      write(join(root, "dashboard", "dist", "index.html"), "prior-dashboard\n");
      write(join(source, "dist", "new.txt"), "verified-dist\n");

      expect(() => withVerifiedArtifactPromotion(root, source, ["dist", "dashboard/dist"], () => undefined))
        .toThrow("verified build is missing dashboard/dist");
      expect(readFileSync(join(root, "dist", "old.txt"), "utf8")).toBe("prior-dist\n");
      expect(readFileSync(join(root, "dashboard", "dist", "index.html"), "utf8")).toBe("prior-dashboard\n");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
