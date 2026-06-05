import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface PackedFile {
  path: string;
}

interface PackManifest {
  files: PackedFile[];
}

function readPackedFiles(): string[] {
  const result = Bun.spawnSync(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  const output = new TextDecoder().decode(result.stdout);
  const manifests = JSON.parse(output) as PackManifest[];
  return manifests[0].files.map((file) => file.path).sort();
}

function hostedMetadataSlugs(): string[] {
  const skillsDir = join(process.cwd(), "skills");
  return readdirSync(skillsDir)
    .filter((entry) => {
      const skillDir = join(skillsDir, entry);
      if (!statSync(skillDir).isDirectory()) return false;
      const pkgPath = join(skillDir, "package.json");
      if (!existsSync(pkgPath)) return false;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { skills?: { runtime?: string; source?: string } };
      return pkg.skills?.runtime === "hosted" || pkg.skills?.source === "remote" || pkg.skills?.source === "private-hosted";
    })
    .sort();
}

function buildEntryPointsForBoundaryScan(): string[] {
  const outputDir = mkdtempSync(join(tmpdir(), "hasna-skills-boundary-"));
  const builds: string[][] = [
    [
      "bun",
      "build",
      "./src/cli/index.tsx",
      "--outdir",
      join(outputDir, "bin"),
      "--target",
      "bun",
      "--external",
      "ink",
      "--external",
      "react",
      "--external",
      "chalk",
    ],
    [
      "bun",
      "build",
      "./src/mcp/index.ts",
      "--outfile",
      join(outputDir, "bin", "mcp.js"),
      "--target",
      "bun",
    ],
    [
      "bun",
      "build",
      "./src/index.ts",
      "--outdir",
      join(outputDir, "dist"),
      "--target",
      "bun",
    ],
  ];

  for (const command of builds) {
    const result = Bun.spawnSync(command, {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  }

  return [
    join(outputDir, "bin", "index.js"),
    join(outputDir, "bin", "mcp.js"),
    join(outputDir, "dist", "index.js"),
  ];
}

describe("public package boundary", () => {
  test("keeps private cloud and self-dependencies out of package metadata", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const dependencies = pkg.dependencies ?? {};
    expect(dependencies["@hasna/cloud"]).toBeUndefined();
    expect(dependencies["@hasna/skills"]).toBeUndefined();

    const scripts = JSON.stringify(pkg.scripts ?? {});
    expect(scripts).not.toContain("aws:bootstrap");
    expect(scripts).not.toContain("preview-stripe");
    expect(scripts).not.toContain("production-stripe");

    const lock = readFileSync(join(process.cwd(), "bun.lock"), "utf8");
    expect(lock).not.toContain("@hasna/cloud");
    expect(lock).not.toContain("@hasna/skills@");
    expect(lock).not.toContain("@hasnatools/platform-skills");
  });

  test("keeps premium implementation source out of the packed public package", () => {
    const files = readPackedFiles();
    const packed = new Set(files);
    const premiumSlugs = hostedMetadataSlugs();

    const leakedPremiumSource = files.filter((path) =>
      premiumSlugs.some((slug) => path.startsWith(`skills/${slug}/src/`)),
    );

    expect(leakedPremiumSource).toEqual([]);
    for (const slug of premiumSlugs) {
      expect(packed.has(`skills/${slug}/package.json`)).toBe(true);
    }
  });

  test("keeps hosted premium implementation source out of the public repository", () => {
    const leakedPremiumSource = hostedMetadataSlugs()
      .filter((slug) => existsSync(join(process.cwd(), "skills", slug, "src")));

    expect(leakedPremiumSource).toEqual([]);
  });

  test("does not strip free local skill source from the packed public package", () => {
    const files = readPackedFiles();
    expect(files).toContain("skills/brand-style-guide/src/index.ts");
  });

  test("keeps legacy service server and cloud scaffolds out of the public package", () => {
    const files = readPackedFiles();
    for (const forbidden of [
      "skills/domainpurchase/src/lib/config.ts",
      "skills/domainpurchase/src/lib/api-client.ts",
      "skills/domainpurchase/.env.example",
      "skills/sms/src/server.ts",
      "skills/sms/src/sse-server.ts",
      "skills/sms/scripts/buy-number.ts",
      "skills/managemcp/src/db/index.ts",
      "skills/managemcp/scripts/migrate.ts",
      "skills/managemcp/.env.example",
    ]) {
      expect(files).not.toContain(forbidden);
    }
  });

  test("keeps private implementation markers out of built entrypoints", () => {
    const builtFiles = buildEntryPointsForBoundaryScan();

    const forbiddenMarkers = [
      "@hasna/cloud",
      "node_modules/@hasna/cloud",
      "@hasnatools/platform-skills",
      "src/platform/",
      "src/platform",
      "STRIPE_",
      "aws:bootstrap",
      "preview-stripe",
      "production-stripe",
    ];

    try {
      for (const file of builtFiles) {
        const content = readFileSync(file, "utf8");
        for (const marker of forbiddenMarkers) {
          expect(content).not.toContain(marker);
        }
      }
    } finally {
      rmSync(join(builtFiles[0], "..", ".."), { recursive: true, force: true });
    }
  });
});
