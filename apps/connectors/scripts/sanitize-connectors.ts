#!/usr/bin/env bun
/**
 * Sanitize connectors for public release
 *
 * This script:
 * 1. Removes .implementation folders (contains session history)
 * 2. Removes internal references from CLAUDE.md files
 * 3. Updates package.json to use neutral naming
 * 4. Removes any .jsonl files
 * 5. Removes scripts/publish.ts (internal publishing)
 */

import { readdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const CONNECTORS_DIR = join(import.meta.dir, "..", "connectors");

// Patterns to remove from CLAUDE.md
const CLAUDE_MD_PATTERNS = [
  /- \*\*Remote API\*\*: `https:\/\/connect\.beepmedia\.com\/.*`\n?/g,
  /- \*\*EC2 Instance\*\*: `beepmedia-.*`\n?/g,
  /- \*\*RDS Database\*\*: `beepmedia-.*`\n?/g,
  /- \*\*S3 Bucket\*\*: `beepmedia-.*`\n?/g,
  /## Infrastructure\n\n.*beepmedia.*\n?/g,
];

// Files/folders to remove
const REMOVE_PATTERNS = [
  ".implementation",
  "scripts/publish.ts",
];

function sanitizeConnector(connectorPath: string, connectorName: string): void {
  console.log(`\nProcessing: ${connectorName}`);

  // 1. Remove .implementation folder
  const implPath = join(connectorPath, ".implementation");
  if (existsSync(implPath)) {
    rmSync(implPath, { recursive: true });
    console.log("  ✓ Removed .implementation folder");
  }

  // 2. Remove scripts/publish.ts
  const publishPath = join(connectorPath, "scripts", "publish.ts");
  if (existsSync(publishPath)) {
    rmSync(publishPath);
    console.log("  ✓ Removed scripts/publish.ts");
    // Remove scripts folder if empty
    const scriptsDir = join(connectorPath, "scripts");
    try {
      if (existsSync(scriptsDir) && readdirSync(scriptsDir).length === 0) {
        rmSync(scriptsDir, { recursive: true });
      }
    } catch (e) {
      // Ignore errors removing empty dir
    }
  }

  // 3. Remove any .jsonl files
  const jsonlFiles = readdirSync(connectorPath, { recursive: true })
    .filter((f) => f.toString().endsWith(".jsonl"));
  for (const file of jsonlFiles) {
    const filePath = join(connectorPath, file.toString());
    rmSync(filePath);
    console.log(`  ✓ Removed ${file}`);
  }

  // 4. Sanitize CLAUDE.md
  const claudeMdPath = join(connectorPath, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    let content = readFileSync(claudeMdPath, "utf-8");
    let modified = false;

    for (const pattern of CLAUDE_MD_PATTERNS) {
      if (pattern.test(content)) {
        content = content.replace(pattern, "");
        modified = true;
      }
    }

    // Remove beepmedia references
    if (content.includes("beepmedia")) {
      content = content.replace(/beepmedia/gi, "");
      modified = true;
    }

    // Remove ## Infrastructure section if it exists and is now empty
    content = content.replace(/## Infrastructure\n\n+(?=##|$)/g, "");

    if (modified) {
      writeFileSync(claudeMdPath, content);
      console.log("  ✓ Sanitized CLAUDE.md");
    }
  }

  // 5. Update package.json
  const pkgPath = join(connectorPath, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    let modified = false;

    // Update package name from @hasnaxyz to @hasna
    if (pkg.name?.startsWith("@hasnaxyz/")) {
      const baseName = pkg.name.replace("@hasnaxyz/", "");
      pkg.name = `@hasna/${baseName}`;
      modified = true;
    }

    // Update author
    if (pkg.author !== "Hasna") {
      pkg.author = "Hasna";
      modified = true;
    }

    // Update repository URL
    if (pkg.repository?.url?.includes("hasnaxyz")) {
      pkg.repository.url = `git+https://github.com/hasna/opensource-connectors.git`;
      modified = true;
    }

    // Remove publishConfig (will use monorepo's)
    if (pkg.publishConfig) {
      delete pkg.publishConfig;
      modified = true;
    }

    // Update keywords to include "hasna"
    if (pkg.keywords && !pkg.keywords.includes("hasna")) {
      pkg.keywords.push("hasna");
      modified = true;
    }

    if (modified) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      console.log("  ✓ Updated package.json");
    }
  }
}

async function main() {
  console.log("🧹 Sanitizing connectors for public release...\n");

  const connectors = readdirSync(CONNECTORS_DIR).filter((f) => {
    const fullPath = join(CONNECTORS_DIR, f);
    return f.startsWith("connect-") && statSync(fullPath).isDirectory();
  });

  console.log(`Found ${connectors.length} connectors to process`);

  for (const connector of connectors) {
    const connectorPath = join(CONNECTORS_DIR, connector);
    sanitizeConnector(connectorPath, connector);
  }

  console.log("\n✅ Sanitization complete!");
}

main().catch(console.error);
