#!/usr/bin/env bun
/**
 * Normalize CLAUDE.md files across all connectors
 *
 * This script ensures all CLAUDE.md files have a consistent structure while
 * preserving connector-specific content.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const CONNECTORS_DIR = join(import.meta.dir, "..", "connectors");

// Standard template sections that all CLAUDE.md files should have
const STANDARD_SECTIONS = [
  "Project Overview",
  "Build & Run Commands",
  "Code Style",
  "Project Structure",
  "Environment Variables",
  "Data Storage",
  "Dependencies",
];

interface ConnectorInfo {
  name: string; // e.g., "figma"
  displayName: string; // e.g., "Figma"
  description: string;
  hasOAuth?: boolean;
  authMethod: string; // "Bearer", "API Key", "OAuth", etc.
  baseUrl?: string;
}

function getConnectorInfo(connectorPath: string, connectorName: string): ConnectorInfo {
  // Read existing CLAUDE.md to extract info
  const claudeMdPath = join(connectorPath, "CLAUDE.md");
  const pkgPath = join(connectorPath, "package.json");

  let description = "";
  let authMethod = "API Key";
  let hasOAuth = false;

  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf-8");

    // Extract description from Project Overview
    const overviewMatch = content.match(/## Project Overview\n\n([^\n]+)/);
    if (overviewMatch) {
      description = overviewMatch[1];
    }

    // Detect auth method
    if (content.includes("OAuth")) {
      authMethod = "OAuth";
      hasOAuth = true;
    } else if (content.includes("Bearer")) {
      authMethod = "Bearer Token";
    } else if (content.includes("x-api-key") || content.includes("xi-api-key")) {
      authMethod = "API Key (Header)";
    } else if (content.includes("sso-key")) {
      authMethod = "SSO Key";
    }
  }

  // Get description from package.json if not found
  if (!description && existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      description = pkg.description || "";
    } catch {}
  }

  // Derive display name from connector name
  const baseName = connectorName.replace("connect-", "");
  const displayName = baseName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return {
    name: baseName,
    displayName,
    description,
    hasOAuth,
    authMethod,
  };
}

function generateClaudeMd(connectorPath: string, connectorName: string): string {
  const info = getConnectorInfo(connectorPath, connectorName);
  const existingPath = join(connectorPath, "CLAUDE.md");

  // Read existing content to preserve CLI commands and other specific content
  let existingContent = "";
  let cliCommands = "";
  let envVars = "";
  let apiModules = "";
  let keyPatterns = "";

  if (existsSync(existingPath)) {
    existingContent = readFileSync(existingPath, "utf-8");

    // Extract CLI Commands section
    const cliMatch = existingContent.match(/## CLI Commands\n([\s\S]*?)(?=\n## |$)/);
    if (cliMatch) {
      cliCommands = cliMatch[1].trim();
    }

    // Extract Environment Variables section
    const envMatch = existingContent.match(/## Environment Variables\n([\s\S]*?)(?=\n## |$)/);
    if (envMatch) {
      envVars = envMatch[1].trim();
    }

    // Extract API Modules section
    const apiMatch = existingContent.match(/## API Modules\n([\s\S]*?)(?=\n## |$)/);
    if (apiMatch) {
      apiModules = apiMatch[1].trim();
    }

    // Extract Key Patterns section
    const patternsMatch = existingContent.match(/## Key Patterns\n([\s\S]*?)(?=\n## |$)/);
    if (patternsMatch) {
      keyPatterns = patternsMatch[1].trim();
    }
  }

  // Generate normalized CLAUDE.md
  let output = `# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

${info.description || `connect-${info.name} is a TypeScript connector for the ${info.displayName} API with multi-profile configuration support.`}

## Build & Run Commands

\`\`\`bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
\`\`\`

## Code Style

- TypeScript with strict mode
- ESM modules (\`type: module\`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

\`\`\`
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
\`\`\`

## Authentication

${info.authMethod} authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: \`connect-${info.name} config set-key <key>\`
${info.hasOAuth ? "- OAuth flow: `connect-" + info.name + " oauth login`" : ""}
`;

  // Add Key Patterns if available
  if (keyPatterns) {
    output += `
## Key Patterns

${keyPatterns}
`;
  }

  // Add API Modules if available
  if (apiModules) {
    output += `
## API Modules

${apiModules}
`;
  }

  // Add CLI Commands if available
  if (cliCommands) {
    output += `
## CLI Commands

${cliCommands}
`;
  }

  // Add Environment Variables
  output += `
## Environment Variables

${envVars || `| Variable | Description |
|----------|-------------|
| \`${info.name.toUpperCase().replace(/-/g, "_")}_API_KEY\` | API key |`}

## Data Storage

\`\`\`
~/.connect/connect-${info.name}/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
\`\`\`

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
`;

  return output;
}

async function main() {
  console.log("🔧 Normalizing CLAUDE.md files...\n");

  const connectors = readdirSync(CONNECTORS_DIR).filter((f) => {
    const fullPath = join(CONNECTORS_DIR, f);
    return f.startsWith("connect-") && statSync(fullPath).isDirectory();
  });

  console.log(`Found ${connectors.length} connectors\n`);

  let updated = 0;
  let created = 0;

  for (const connector of connectors) {
    const connectorPath = join(CONNECTORS_DIR, connector);
    const claudeMdPath = join(connectorPath, "CLAUDE.md");
    const existed = existsSync(claudeMdPath);

    const normalizedContent = generateClaudeMd(connectorPath, connector);
    writeFileSync(claudeMdPath, normalizedContent);

    if (existed) {
      console.log(`  ✓ Updated: ${connector}`);
      updated++;
    } else {
      console.log(`  + Created: ${connector}`);
      created++;
    }
  }

  console.log(`\n✅ Done! Updated ${updated}, created ${created} CLAUDE.md files`);
}

main().catch(console.error);
