#!/usr/bin/env bun
/**
 * Copy curated connectors from individual repos to the monorepo
 *
 * This script copies the 64 curated public connectors.
 * Excluded: Romanian store scrapers, travel scrapers, clickbank, escrow
 */

import { existsSync, cpSync, rmSync, readdirSync } from "fs";
import { join, basename } from "path";

const SOURCE_DIR = "/Users/hasna/Workspace/hasnaxyz/connector/connectdev";
const TARGET_DIR = join(import.meta.dir, "..", "connectors");

// Curated list of 64 public connectors
const CURATED_CONNECTORS = [
  // AI & ML
  "connect-anthropic",
  "connect-openai",
  "connect-xai",
  "connect-mistral",
  "connect-googlegemini",
  "connect-huggingface",
  "connect-stabilityai",
  "connect-midjourney",
  "connect-heygen",
  "connect-hedra",
  "connect-elevenlabs",
  "connect-reducto",

  // Developer Tools
  "connect-github",
  "connect-docker",
  "connect-sentry",
  "connect-cloudflare",
  "connect-googlecloud",
  "connect-aws",
  "connect-e2b",
  "connect-firecrawl",
  "connect-browseruse",
  "connect-shadcn",

  // Design & Content
  "connect-figma",
  "connect-webflow",
  "connect-wix",
  "connect-icons8",

  // Communication
  "connect-gmail",
  "connect-discord",
  "connect-twilio",
  "connect-resend",
  "connect-zoom",
  "connect-maropost",

  // Social Media
  "connect-x",
  "connect-reddit",
  "connect-substack",
  "connect-meta",
  "connect-snap",
  "connect-tiktok",
  "connect-youtube",

  // Commerce & Finance
  "connect-stripe",
  "connect-stripeatlas",
  "connect-shopify",
  "connect-revolut",
  "connect-mercury",
  "connect-pandadoc",

  // Google Workspace
  "connect-google",
  "connect-googledrive",
  "connect-googledocs",
  "connect-googlesheets",
  "connect-googlecalendar",
  "connect-googletasks",
  "connect-googlecontacts",
  "connect-googlemaps",

  // Data & Analytics
  "connect-exa",
  "connect-mixpanel",
  "connect-openweathermap",
  "connect-brandsight",

  // Business Tools
  "connect-quo",
  "connect-tinker",
  "connect-sedo",

  // Patents & IP
  "connect-uspto",

  // Advertising
  "connect-xads",
];

// Files/directories to exclude when copying
const EXCLUDE_PATTERNS = [
  ".git",
  "node_modules",
  "dist",
  "bin",
  ".DS_Store",
  "bun.lock",
];

function shouldExclude(name: string): boolean {
  return EXCLUDE_PATTERNS.includes(name);
}

function copyConnector(name: string): boolean {
  const sourcePath = join(SOURCE_DIR, name);
  const targetPath = join(TARGET_DIR, name);

  if (!existsSync(sourcePath)) {
    console.log(`  ⚠️  Not found: ${name}`);
    return false;
  }

  // Remove existing if present
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true });
  }

  // Copy with filter
  cpSync(sourcePath, targetPath, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      return !shouldExclude(name);
    },
  });

  console.log(`  ✓ Copied: ${name}`);
  return true;
}

async function main() {
  console.log("\n📦 Copying curated connectors...\n");
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Target: ${TARGET_DIR}\n`);

  let copied = 0;
  let failed = 0;

  for (const connector of CURATED_CONNECTORS) {
    if (copyConnector(connector)) {
      copied++;
    } else {
      failed++;
    }
  }

  console.log(`\n✅ Done! Copied ${copied} connectors`);
  if (failed > 0) {
    console.log(`⚠️  ${failed} connectors not found`);
  }

  // List what's in connectors dir
  const finalConnectors = readdirSync(TARGET_DIR).filter(
    (f) => f.startsWith("connect-")
  );
  console.log(`\n📁 Connectors directory: ${finalConnectors.length} connectors`);
}

main().catch(console.error);
