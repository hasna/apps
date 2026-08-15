import { describe, test, expect } from "bun:test";
import { detectDeployUrl, parsePrNumber, buildPreviewUrl } from "./preview-detect.js";

describe("preview deploy URL detection (OPE9-00277)", () => {
  describe("detectDeployUrl", () => {
    test("detects Vercel preview", () => {
      const info = detectDeployUrl({
        VERCEL_URL: "myapp-abc123.vercel.app",
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: "deadbeef",
        VERCEL_GIT_COMMIT_REF: "feature-branch",
      });
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("vercel");
      expect(info!.url).toBe("https://myapp-abc123.vercel.app");
      expect(info!.commit).toBe("deadbeef");
      expect(info!.branch).toBe("feature-branch");
    });

    test("ignores Vercel production", () => {
      const info = detectDeployUrl({ VERCEL_URL: "myapp.vercel.app", VERCEL: "0" });
      expect(info).toBeNull();
    });

    test("detects Railway deploy", () => {
      const info = detectDeployUrl({ RAILWAY_PUBLIC_URL: "https://myapp-production.up.railway.app" });
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("railway");
      expect(info!.url).toBe("https://myapp-production.up.railway.app");
    });

    test("detects Render deploy", () => {
      const info = detectDeployUrl({
        RENDER_EXTERNAL_URL: "https://myapp.onrender.com",
        RENDER_GIT_BRANCH: "main",
        RENDER_GIT_COMMIT: "abc123",
      });
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("render");
    });

    test("detects Fly.io deploy", () => {
      const info = detectDeployUrl({
        FLY_APP_NAME: "myapp",
        FLY_RELEASE_VERSION: "v3",
      });
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("fly");
      expect(info!.url).toBe("https://myapp.fly.dev");
    });

    test("detects Netlify deploy preview", () => {
      const info = detectDeployUrl({
        CONTEXT: "deploy-preview",
        DEPLOY_URL: "https://abc123--myapp.netlify.app",
        BRANCH: "feature/login",
        COMMIT_REF: "xyz789",
      });
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("netlify");
    });

    test("detects Cloudflare Pages preview", () => {
      const info = detectDeployUrl({
        CF_PAGES_URL: "https://abc123.myproject.pages.dev",
        CF_PAGES_DEPLOYMENT_TYPE: "preview",
        CF_PAGES_BRANCH: "develop",
        CF_PAGES_COMMIT_SHA: "aaa111",
      });
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("cloudflare");
    });

    test("detects custom PR preview URL", () => {
      const info = detectDeployUrl({
        GITHUB_EVENT_NAME: "pull_request",
        PR_PREVIEW_URL: "https://pr-42--myapp.preview.example.com",
      });
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("custom");
    });

    test("returns null when no deploy context", () => {
      const info = detectDeployUrl({ PATH: "/usr/bin" });
      expect(info).toBeNull();
    });
  });

  describe("parsePrNumber", () => {
    test("parses pr-123 format", () => {
      expect(parsePrNumber("pr-123--myapp.vercel.app")).toBe(123);
    });

    test("parses pr_456 format", () => {
      expect(parsePrNumber("pr_456_myapp")).toBe(456);
    });

    test("parses pull-789 format", () => {
      expect(parsePrNumber("pull-789--myapp.netlify.app")).toBe(789);
    });

    test("parses pulls/123 format", () => {
      expect(parsePrNumber("https://example.com/pulls/42/preview")).toBe(42);
    });

    test("returns null for non-PR URLs", () => {
      expect(parsePrNumber("https://myapp.production.com")).toBeNull();
    });
  });

  describe("buildPreviewUrl", () => {
    test("returns baseUrl for known providers", () => {
      expect(buildPreviewUrl("https://abc123.vercel.app", 42, "vercel"))
        .toBe("https://abc123.vercel.app");
    });

    test("returns null for unknown provider", () => {
      expect(buildPreviewUrl("https://unknown.example.com", 42)).toBeNull();
    });
  });
});
