import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

interface ServiceContractManifest {
  readonly schema?: string;
  readonly name?: string;
  readonly class?: string;
  readonly contractVersion?: string;
  readonly kitVersion?: string;
  readonly bins?: readonly string[];
  readonly hosting?: readonly string[];
  readonly serviceSurfaces?: readonly { readonly kind?: string; readonly status?: string }[];
  readonly metadata?: {
    readonly release?: { readonly artifactScan?: { readonly script?: string } };
  };
}

const manifest = JSON.parse(
  readFileSync(join(root, "hasna.contract.json"), "utf8"),
) as ServiceContractManifest;

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
};

const scripts = packageJson.scripts ?? {};

// Subcommands @hasna/contracts 0.8.5 actually exposes. A script naming anything
// outside this list exits 1 with "unknown command" and can never pass.
const kitSubcommands = [
  "schemas",
  "validate",
  "conformance",
  "no-cloud-scan",
  "repo-conformance",
  "vendor-kit",
  "issue-key",
  "artifact-scan",
  "secure-local-store",
];

function kitInvocations(body: string): { spec: string; subcommand: string | undefined }[] {
  return body
    .split(/&&|\|\||;/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.includes("bunx") || tokens.includes("npx"))
    .map((tokens) => {
      const runnerIndex = tokens.findIndex((token) => token === "bunx" || token === "npx");
      const operands = tokens.slice(runnerIndex + 1).filter((token) => !token.startsWith("-"));
      return { spec: operands[0] ?? "", subcommand: operands[1] };
    })
    .filter((invocation) => invocation.spec.startsWith("@hasna/contracts"));
}

describe("@hasna/banking service contract manifest", () => {
  test("declares the hasna.service_contract.v1 shape the conformance kit validates", () => {
    expect(manifest.schema).toBe("hasna.service_contract.v1");
    expect(manifest.contractVersion).toBe("v1");
    // Lowercase dashed app short-name, not the scoped npm package name.
    expect(manifest.name).toBe("banking");
    expect(["library", "cli-with-store", "service", "saas"]).toContain(manifest.class as string);
    expect(manifest.kitVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.hosting).toContain("user-hosted");
  });

  test("declares exactly the bins package.json ships", () => {
    expect([...(manifest.bins ?? [])].sort()).toEqual(Object.keys(packageJson.bin ?? {}).sort());
  });

  test("declares a supported surface for every entrypoint the package ships", () => {
    const supported = (manifest.serviceSurfaces ?? [])
      .filter((surface) => surface.status === "supported")
      .map((surface) => surface.kind);

    expect(supported).toContain("cli");
    expect(supported).toContain("mcp");
    expect(supported).toContain("sdk");
  });

  test("ships the manifest to consumers", () => {
    expect(packageJson.files).toContain("hasna.contract.json");
  });
});

describe("@hasna/banking release gate wiring", () => {
  test("names a real package script as the packed-artifact scan", () => {
    const declared = manifest.metadata?.release?.artifactScan?.script;
    expect(declared).toBeDefined();
    expect(Object.keys(scripts)).toContain(declared as string);
  });

  test("reaches the packed-artifact scan from prepack", () => {
    const declared = manifest.metadata?.release?.artifactScan?.script as string;
    expect(scripts.prepack).toContain(`bun run ${declared}`);
  });

  test("scans a packed tarball rather than the source tree", () => {
    const declared = manifest.metadata?.release?.artifactScan?.script as string;
    const body = scripts[declared] ?? "";
    expect(body).toContain("bun pm pack");
    for (const invocation of kitInvocations(body)) {
      expect(invocation.subcommand).toBe("artifact-scan");
    }
  });

  test("pins the contract kit in every script that runs it", () => {
    for (const [name, body] of Object.entries(scripts)) {
      for (const invocation of kitInvocations(body)) {
        expect(
          invocation.spec,
          `script '${name}' must pin the kit version so the gate is reproducible`,
        ).toMatch(/^@hasna\/contracts@\d+\.\d+\.\d+$/);
      }
    }
  });

  test("pins the same kit version the manifest tracks", () => {
    for (const body of Object.values(scripts)) {
      for (const invocation of kitInvocations(body)) {
        expect(invocation.spec).toBe(`@hasna/contracts@${manifest.kitVersion}`);
      }
    }
  });

  test("invokes only subcommands the contract kit exposes", () => {
    for (const [name, body] of Object.entries(scripts)) {
      for (const invocation of kitInvocations(body)) {
        expect(
          kitSubcommands,
          `script '${name}' invokes '${invocation.subcommand}', which the kit does not expose`,
        ).toContain(invocation.subcommand as string);
      }
    }
  });

  test("checks repository conformance through the kit's repo-conformance command", () => {
    const body = scripts["contracts:check"] ?? "";
    expect(kitInvocations(body).map((invocation) => invocation.subcommand)).toContain(
      "repo-conformance",
    );
  });
});

describe("@hasna/banking continuous integration", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");

  test("enforces the conformance gate this repository declares", () => {
    expect(workflow).toContain("bun run contracts:check");
  });

  test("enforces the packed-artifact scan the release gate declares", () => {
    const declared = manifest.metadata?.release?.artifactScan?.script as string;
    expect(workflow).toContain(`bun run ${declared}`);
  });
});
