import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createReleaseArtifactManifest,
  validateReleaseArtifactManifest,
} from "./release-artifact-manifest.js";

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("release artifact manifest", () => {
  test("deterministically binds every dist and dashboard artifact except provenance itself", () => {
    const root = mkdtempSync(join(tmpdir(), "todos-release-artifacts-"));
    try {
      write(join(root, "dist", "server", "index.js"), "server\n");
      write(join(root, "dist", "index.d.ts"), "export {};\n");
      write(join(root, "dist", "release-provenance.json"), "ignored-self-reference\n");
      write(join(root, "dashboard", "dist", "index.html"), "<main></main>\n");
      write(join(root, "dashboard", "dist", "assets", "app.js"), "app\n");

      const first = createReleaseArtifactManifest(root);
      const second = createReleaseArtifactManifest(root);
      expect(first).toEqual(second);
      expect(first.files.map((entry) => entry.path)).toEqual([
        "dashboard/dist/assets/app.js",
        "dashboard/dist/index.html",
        "dist/index.d.ts",
        "dist/server/index.js",
      ]);
      expect(validateReleaseArtifactManifest(root, first)).toEqual([]);

      write(join(root, "dist", "server", "index.js"), "substituted\n");
      expect(validateReleaseArtifactManifest(root, first).map((failure) => failure.check)).toEqual(
        expect.arrayContaining(["provenance-artifact-integrity", "provenance-artifact-manifest-match"]),
      );
      write(join(root, "dist", "server", "index.js"), "server\n");

      unlinkSync(join(root, "dashboard", "dist", "assets", "app.js"));
      expect(validateReleaseArtifactManifest(root, first).map((failure) => failure.check)).toContain("provenance-artifact-missing");
      write(join(root, "dashboard", "dist", "assets", "app.js"), "app\n");
      write(join(root, "dashboard", "dist", "assets", "extra.css"), "body{}\n");
      expect(validateReleaseArtifactManifest(root, first).map((failure) => failure.check)).toContain("provenance-artifact-unbound");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a manifest whose recorded entries were edited without recomputing its digest", () => {
    const root = mkdtempSync(join(tmpdir(), "todos-release-artifacts-"));
    try {
      write(join(root, "dist", "server", "index.js"), "server\n");
      write(join(root, "dashboard", "dist", "index.html"), "<main></main>\n");
      const manifest = createReleaseArtifactManifest(root);
      const forged = {
        ...manifest,
        files: manifest.files.map((entry, index) => index === 0 ? { ...entry, sha256: "f".repeat(64) } : entry),
      };
      expect(validateReleaseArtifactManifest(root, forged).map((failure) => failure.check)).toContain(
        "provenance-artifact-manifest-hash",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
