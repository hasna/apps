#!/usr/bin/env bun
/**
 * Normalize README.md files for all connectors
 *
 * This script generates consistent README.md files for each connector
 * by extracting information from CLAUDE.md and package.json
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const CONNECTORS_DIR = join(import.meta.dir, "..", "connectors");

interface ConnectorInfo {
  name: string;
  displayName: string;
  description: string;
  envVars: Array<{ name: string; description: string }>;
  cliCommands: string;
}

function extractFromClaudeMd(claudeMdPath: string): Partial<ConnectorInfo> {
  if (!existsSync(claudeMdPath)) return {};

  const content = readFileSync(claudeMdPath, "utf-8");
  const info: Partial<ConnectorInfo> = {};

  // Extract environment variables section
  const envMatch = content.match(/## Environment Variables\n\n\|[^|]+\|[^|]+\|\n\|[-]+\|[-]+\|\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (envMatch) {
    const envLines = envMatch[1].trim().split("\n").filter(l => l.startsWith("|"));
    info.envVars = envLines.map(line => {
      const parts = line.split("|").filter(Boolean).map(s => s.trim());
      return { name: parts[0]?.replace(/`/g, "") || "", description: parts[1] || "" };
    }).filter(e => e.name);
  }

  // Extract CLI commands section
  const cliMatch = content.match(/## CLI Commands\n([\s\S]*?)(?=\n## |$)/);
  if (cliMatch) {
    info.cliCommands = cliMatch[1].trim();
  }

  return info;
}

function generateReadme(connectorName: string): string {
  const connectorPath = join(CONNECTORS_DIR, connectorName);
  const pkgPath = join(connectorPath, "package.json");
  const claudeMdPath = join(connectorPath, "CLAUDE.md");

  // Read package.json
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const displayName = connectorName.replace("connect-", "");
  const titleCase = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  // Extract from CLAUDE.md
  const claudeInfo = extractFromClaudeMd(claudeMdPath);

  // Build environment variables table
  let envTable = "";
  if (claudeInfo.envVars && claudeInfo.envVars.length > 0) {
    envTable = `## Environment Variables

| Variable | Description |
|----------|-------------|
${claudeInfo.envVars.map(e => `| \`${e.name}\` | ${e.description} |`).join("\n")}`;
  }

  // Build CLI commands section
  let cliSection = "";
  if (claudeInfo.cliCommands) {
    cliSection = `## CLI Commands

${claudeInfo.cliCommands}`;
  } else {
    cliSection = `## CLI Commands

\`\`\`bash
${connectorName} config set-key <key>     # Set API key
${connectorName} config show              # Show config
${connectorName} profile list             # List profiles
${connectorName} profile use <name>       # Switch profile
\`\`\``;
  }

  return `# ${connectorName}

${pkg.description}

## Installation

\`\`\`bash
bun install -g ${pkg.name}
\`\`\`

## Quick Start

\`\`\`bash
# Set your API key
${connectorName} config set-key YOUR_API_KEY

# Or use environment variable
export ${claudeInfo.envVars?.[0]?.name || `${displayName.toUpperCase()}_API_KEY`}=YOUR_API_KEY
\`\`\`

${cliSection}

## Profile Management

\`\`\`bash
# Create profiles for different accounts
${connectorName} profile create work --api-key xxx --use
${connectorName} profile create personal --api-key yyy

# Switch profiles
${connectorName} profile use work

# Use profile for single command
${connectorName} -p personal <command>

# List profiles
${connectorName} profile list
\`\`\`

## Library Usage

\`\`\`typescript
import { ${titleCase} } from '${pkg.name}';

const client = new ${titleCase}({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
\`\`\`

${envTable}

## Data Storage

Configuration stored in \`~/.connect/${connectorName}/\`:

\`\`\`
~/.connect/${connectorName}/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
\`\`\`

## Development

\`\`\`bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
\`\`\`

## License

MIT
`;
}

async function main() {
  console.log("📄 Normalizing README.md files for all connectors...\n");

  const connectors = readdirSync(CONNECTORS_DIR).filter((f) => {
    const fullPath = join(CONNECTORS_DIR, f);
    return f.startsWith("connect-") && statSync(fullPath).isDirectory();
  });

  console.log(`Found ${connectors.length} connectors to process\n`);

  let updated = 0;
  for (const connector of connectors) {
    const readmePath = join(CONNECTORS_DIR, connector, "README.md");

    try {
      const readme = generateReadme(connector);
      writeFileSync(readmePath, readme);
      console.log(`  ✓ ${connector}`);
      updated++;
    } catch (error) {
      console.error(`  ✗ ${connector}: ${error}`);
    }
  }

  console.log(`\n✅ Updated ${updated}/${connectors.length} README files`);
}

main().catch(console.error);
