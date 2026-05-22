import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "./config.js";
import {
  getLocalExtension,
  discoverLocalExtensions,
  inspectExtensionSource,
  installLocalExtension,
  listLocalExtensions,
  removeLocalExtension,
  testExtensionCompatibility,
  validateExtensionManifest,
} from "./local-extensions.js";

let home: string;
let previousHome: string | undefined;

function writeManifest(dir: string, overrides: Record<string, unknown> = {}) {
  const path = join(dir, "todos.extension.json");
  writeFileSync(path, JSON.stringify({
    schema_version: 1,
    name: "demo-extension",
    version: "1.0.0",
    compatibility: { todos: "*" },
    permissions: ["tasks:read", "runs:write"],
    commands: [{ name: "demo", command: "echo demo" }],
    mcp_tools: [{ name: "demo_tool", description: "local demo" }],
    templates: [{ name: "demo-template", kind: "task", content: "Do {{thing}}", variables: ["thing"] }],
    renderers: [{ name: "demo-renderer", target: "task", template: "demo-template" }],
    ...overrides,
  }, null, 2));
  return path;
}

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-extension-home-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

describe("local extension registry", () => {
  test("validates and installs local manifests without hosted registry access", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "todos-extension-source-"));
    try {
      const manifestPath = writeManifest(sourceDir);
      const inspected = inspectExtensionSource(sourceDir);

      expect(inspected.source_type).toBe("directory");
      expect(inspected.manifest_path).toBe(manifestPath);
      expect(inspected.validation.ok).toBe(true);
      expect(inspected.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);

      const installed = installLocalExtension({ source: sourceDir, checksum: inspected.checksum, trust: false });
      expect(installed).toMatchObject({
        name: "demo-extension",
        version: "1.0.0",
        trusted: false,
        status: "needs_review",
        checksum: inspected.checksum,
        signature_verified: false,
      });
      expect(installed.warnings).toEqual(expect.arrayContaining([
        "extension is unsigned",
        "extension installed as needs_review until trusted explicitly",
      ]));
      expect(listLocalExtensions()).toHaveLength(1);
      const stored = getLocalExtension("demo-extension");
      expect(stored?.manifest.permissions).toEqual(["runs:write", "tasks:read"]);
      expect(stored?.diagnostics?.summary).toMatchObject({ commands: 1, mcp_tools: 1, templates: 1, renderers: 1 });
      expect(removeLocalExtension("demo-extension")).toBe(true);
      expect(listLocalExtensions()).toHaveLength(0);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test("supports offline bundles and detached checksum signatures", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "todos-extension-bundle-"));
    try {
      const bundlePath = join(sourceDir, "bundle.todos-extension.json");
      writeFileSync(bundlePath, JSON.stringify({
        manifest: {
          name: "signed-extension",
          version: "2.0.0",
          compatibility: { todos: "*" },
          permissions: ["tasks:write"],
          hooks: ["task.completed"],
        },
        files: {
          "README.md": "# signed extension",
        },
      }, null, 2));
      const inspected = inspectExtensionSource(bundlePath);
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const signer = createSign("sha256");
      signer.update(inspected.checksum);
      signer.end();
      const signature = signer.sign(privateKey).toString("base64");
      const publicPem = publicKey.export({ type: "pkcs1", format: "pem" }).toString();

      const installed = installLocalExtension({
        source: bundlePath,
        checksum: inspected.checksum,
        signature,
        public_key: publicPem,
        trust: true,
      });

      expect(installed.source_type).toBe("bundle");
      expect(installed.status).toBe("trusted");
      expect(installed.signature_verified).toBe(true);
      expect(installed.warnings).not.toContain("extension is unsigned");
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test("rejects checksum mismatches and incompatible manifests", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "todos-extension-invalid-"));
    try {
      writeManifest(sourceDir, { compatibility: { todos: "999.0.0" } });
      const validation = validateExtensionManifest({
        name: "demo-extension",
        version: "1.0.0",
        compatibility: { todos: "999.0.0" },
        permissions: ["tasks:read"],
      });
      expect(validation.ok).toBe(false);
      expect(validation.compatible).toBe(false);
      expect(() => installLocalExtension({ source: sourceDir })).toThrow(/requires @hasna\/todos/);

      writeManifest(sourceDir);
      expect(() => installLocalExtension({ source: sourceDir, checksum: "sha256:bad" })).toThrow(/checksum mismatch/);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test("reports CLI MCP permission and sandbox compatibility diagnostics", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "todos-extension-compat-"));
    try {
      writeManifest(sourceDir, {
        permissions: ["tasks:read", "badpermission"],
        templates: [
          { name: "missing-template-body" },
        ],
        renderers: [
          { name: "bad-renderer", target: "task", template: "missing" },
          { name: "command-renderer", target: "task", command: "rm -rf /tmp/nope", permissions: ["commands:run"], write_paths: ["../outside"] },
        ],
        commands: [
          { name: "list", command: "rm -rf /tmp/nope", permissions: ["commands:run"], write_paths: ["../outside"] },
          { name: "agent-safe", command: "todos status --json", permissions: ["tasks:read"] },
        ],
        mcp_tools: [
          { name: "list_tasks", permissions: ["tasks:read"] },
          { name: "extension_status", permissions: ["tasks:read"] },
        ],
      });

      const report = testExtensionCompatibility(sourceDir);
      expect(report.ok).toBe(false);
      expect(report.summary).toMatchObject({
        commands: 2,
        mcp_tools: 2,
        templates: 1,
        renderers: 2,
        permissions: 6,
        sandbox_checks: 3,
      });
      expect(report.errors).toContain("MCP tool list_tasks conflicts with a built-in todos tool");
      expect(report.errors).toContain("template missing-template-body needs path or inline content");
      expect(report.errors).toContain("renderer bad-renderer references unknown template missing");
      expect(report.warnings).toEqual(expect.arrayContaining([
        "command list shadows a built-in todos command name",
        "renderer command will be checked by the local runner sandbox",
        "permission should use resource:action format such as tasks:read, runs:write, commands:run, or *",
      ]));
      expect(report.validation.sandbox_checks.some((check) => check.command_name === "list" && !check.allowed)).toBe(true);
      expect(report.validation.sandbox_checks.some((check) => check.command_name === "renderer:command-renderer" && !check.allowed)).toBe(true);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test("discovers project extension sources without installing them", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "todos-extension-project-"));
    const extensionDir = join(projectDir, ".todos", "extensions");
    mkdirSync(extensionDir, { recursive: true });
    try {
      writeManifest(extensionDir, { name: "project-extension", commands: [], mcp_tools: [], hooks: ["task.completed"] });

      const report = discoverLocalExtensions({ project_path: projectDir });
      expect(report.local_only).toBe(true);
      expect(report.no_network).toBe(true);
      expect(report.project_path).toBe(projectDir);
      expect(report.discovered.map((item) => item.manifest.name)).toEqual(["project-extension"]);
      expect(report.installed).toEqual([]);
      expect(report.warnings).toEqual([]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
