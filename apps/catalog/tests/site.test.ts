import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "../src/contracts.js";
import { escapeHtml, generateSite, installCommand, renderAppPage } from "../src/site.js";

function makeApp(appId: string, overrides: Partial<App> = {}): App {
  return {
    schema: "hasna.app.v1",
    id: `app_${appId.replaceAll("-", "_")}`,
    createdAt: "2026-07-06T08:00:00.000Z",
    appId,
    npmName: `@example/${appId.replace(/^open-/, "")}`,
    repoFolder: appId,
    githubUrl: `https://github.com/example/${appId}`,
    projectSlug: appId,
    surfaces: { bins: [appId.replace(/^open-/, "")] },
    lifecycle: "active",
    releaseChannel: "stable",
    tags: ["oss"],
    metadata: { version: "1.2.3" },
    ...overrides,
  } as App;
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "catalog-site-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("generateSite", () => {
  it("renders an index page and one landing page per app", () => {
    const apps = [makeApp("open-alpha", { summary: "Task tracking" }), makeApp("open-beta")];
    const result = generateSite({ apps, outDir, generatedAt: "2026-07-06T09:00:00.000Z" });
    expect(result.appCount).toBe(2);
    expect(result.pages.length).toBe(3);
    expect(existsSync(join(outDir, "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "apps", "open-alpha", "index.html"))).toBe(true);

    const index = readFileSync(join(outDir, "index.html"), "utf8");
    expect(index).toContain("open-alpha");
    expect(index).toContain("Task tracking");
    expect(index).toContain("v1.2.3");

    const page = readFileSync(join(outDir, "apps", "open-alpha", "index.html"), "utf8");
    expect(page).toContain("bun add -g @example/alpha");
    expect(page).toContain("https://github.com/example/open-alpha");
    expect(page).toContain("https://www.npmjs.com/package/@example/alpha");
    expect(page).toContain("v1.2.3");
  });

  it("escapes HTML in app fields", () => {
    const app = makeApp("open-x", { summary: 'Hello <script>alert("x")</script>' });
    const html = renderAppPage(app, { apps: [app], outDir });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("helpers", () => {
  it("escapeHtml escapes all special characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("installCommand uses bun", () => {
    expect(installCommand(makeApp("open-alpha"))).toBe("bun add -g @example/alpha");
  });
});
