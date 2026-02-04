#!/usr/bin/env bun
/**
 * Create AGENTS.md and GEMINI.md files identical to CLAUDE.md for all connectors
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const CONNECTORS_DIR = join(import.meta.dir, "..", "connectors");

async function main() {
  console.log("Creating AGENTS.md and GEMINI.md files...\n");

  const connectors = readdirSync(CONNECTORS_DIR).filter((f) => {
    const fullPath = join(CONNECTORS_DIR, f);
    return f.startsWith("connect-") && statSync(fullPath).isDirectory();
  });

  console.log(`Found ${connectors.length} connectors\n`);

  let created = 0;

  for (const connector of connectors) {
    const connectorPath = join(CONNECTORS_DIR, connector);
    const claudeMdPath = join(connectorPath, "CLAUDE.md");
    const agentsMdPath = join(connectorPath, "AGENTS.md");
    const geminiMdPath = join(connectorPath, "GEMINI.md");

    if (existsSync(claudeMdPath)) {
      const content = readFileSync(claudeMdPath, "utf-8");

      // Create AGENTS.md (replace CLAUDE.md reference in header)
      const agentsContent = content.replace(
        "# CLAUDE.md",
        "# AGENTS.md"
      ).replace(
        "This file provides guidance to Claude Code",
        "This file provides guidance to AI coding agents"
      );
      writeFileSync(agentsMdPath, agentsContent);

      // Create GEMINI.md (replace CLAUDE.md reference in header)
      const geminiContent = content.replace(
        "# CLAUDE.md",
        "# GEMINI.md"
      ).replace(
        "This file provides guidance to Claude Code",
        "This file provides guidance to Gemini"
      );
      writeFileSync(geminiMdPath, geminiContent);

      console.log(`  ✓ ${connector}`);
      created++;
    } else {
      console.log(`  ⚠ ${connector} - no CLAUDE.md`);
    }
  }

  console.log(`\n✅ Created AGENTS.md and GEMINI.md for ${created} connectors`);
}

main().catch(console.error);
