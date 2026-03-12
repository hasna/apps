#!/usr/bin/env bun
/**
 * Seed the configs DB with all current AI coding agent configurations.
 * Run: bun run scripts/seed.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";
import { getDatabase } from "../src/db/database";
import { createConfig, getConfig, getConfigStats } from "../src/db/configs";
import { detectFormat } from "../src/lib/sync";
import type { ConfigAgent, ConfigCategory, ConfigFormat } from "../src/types/index";

const home = homedir();
const db = getDatabase();

function ingest(
  filePath: string,
  name: string,
  category: ConfigCategory,
  agent: ConfigAgent,
  kind: "file" | "reference" = "file",
  description?: string
) {
  const abs = filePath.startsWith("~/") ? join(home, filePath.slice(2)) : filePath;
  if (!existsSync(abs) || statSync(abs).isDirectory()) return;
  const content = readFileSync(abs, "utf-8");
  if (content.length > 500_000) { console.log(`  skip (too large): ${filePath}`); return; }
  const targetPath = abs.replace(home, "~");
  const format = detectFormat(abs);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  try { getConfig(slug, db); console.log(`  = ${slug}`); return; } catch { /* create */ }
  const c = createConfig({ name, category, agent, format, content, target_path: kind === "reference" ? null : targetPath, kind, description }, db);
  console.log(`  + ${c.slug} [${category}/${agent}]`);
}

function ingestDir(dir: string, category: ConfigCategory, agent: ConfigAgent) {
  const abs = dir.startsWith("~/") ? join(home, dir.slice(2)) : dir;
  if (!existsSync(abs)) return;
  const SKIP = ["telemetry", "sessions", "node_modules", ".git", "recordings", "logs"];
  const files = readdirSync(abs, { withFileTypes: true });
  for (const f of files) {
    if (SKIP.some((s) => f.name.includes(s))) continue;
    if (f.isFile()) {
      const fullPath = join(abs, f.name);
      const targetPath = fullPath.replace(home, "~");
      const name = `${dir.replace("~/", "")}/${f.name}`;
      ingest(fullPath, name, category, agent);
    }
  }
}

console.log("\n@hasna/configs — seeding initial configurations\n");

// ── Claude Code ─────────────────────────────────────────────────────────────
console.log("Claude Code configs:");
ingest("~/.claude/CLAUDE.md", "Claude CLAUDE.md", "rules", "claude");
ingest("~/.claude/settings.json", "Claude settings.json", "agent", "claude", "file");
ingest("~/.claude/keybindings.json", "Claude keybindings.json", "agent", "claude", "file");

// Rules directory
console.log("\nClaude rules:");
const rulesDir = join(home, ".claude", "rules");
if (existsSync(rulesDir)) {
  const files = readdirSync(rulesDir).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const abs = join(rulesDir, f);
    const content = readFileSync(abs, "utf-8");
    const slug = `claude-rules-${f.replace(".md", "")}`;
    try { getConfig(slug.toLowerCase().replace(/[^a-z0-9]+/g, "-"), db); console.log(`  = claude-rules-${f}`); continue; } catch { /* create */ }
    const c = createConfig({ name: `Claude rules/${f}`, category: "rules", agent: "claude", format: "markdown", content, target_path: `~/.claude/rules/${f}` }, db);
    console.log(`  + ${c.slug}`);
  }
}

// ── Codex ────────────────────────────────────────────────────────────────────
console.log("\nCodex configs:");
ingest("~/.codex/config.toml", "Codex config.toml", "agent", "codex");
ingest("~/.codex/AGENTS.md", "Codex AGENTS.md", "rules", "codex");

// ── Gemini ───────────────────────────────────────────────────────────────────
console.log("\nGemini configs:");
ingest("~/.gemini/settings.json", "Gemini settings.json", "agent", "gemini");
ingest("~/.gemini/GEMINI.md", "Gemini GEMINI.md", "rules", "gemini");

// ── Shell ────────────────────────────────────────────────────────────────────
console.log("\nShell configs:");
ingest("~/.zshrc", "zshrc", "shell", "zsh");
ingest("~/.zprofile", "zprofile", "shell", "zsh");

// ── Git ──────────────────────────────────────────────────────────────────────
console.log("\nGit configs:");
ingest("~/.gitconfig", "gitconfig", "git", "git");
ingest("~/.gitignore_global", "gitignore-global", "git", "git");

// ── Tools ────────────────────────────────────────────────────────────────────
console.log("\nTool configs:");
ingest("~/.npmrc", "npmrc", "tools", "npm");

// ── Reference docs ───────────────────────────────────────────────────────────
console.log("\nReference docs:");

const workspaceDoc = `# Workspace Structure Convention

All development work lives in ~/Workspace/, organized in a 4-level hierarchy:

\`\`\`
~/Workspace/{division}/{team}/{sub-team}/{repo}/
\`\`\`

## Divisions
hasnaai, hasnafamily, hasnafoundation, hasnastudio, hasnasystems, hasnatools, hasnaxyz

## Teams
agent, connector, engine, hook, internalapp, offer, plugin, project, scaffold, service, skill, template, tool, venture

## Sub-teams (lifecycle)
*dev (active), *maintain (maintenance), *review (under review), *archive (archived)

## Repo naming: {type}-{name}
Examples: tool-skillsmd, scaffold-mcp, engine-offer
`;

const secretsSchemaDoc = `# .secrets File Schema

Location: ~/.secrets (sourced by ~/.zshrc)
Format: export KEY_NAME="value"

## Keys
| Key | Description |
|-----|-------------|
| ANTHROPIC_API_KEY | Claude/Anthropic AI |
| OPENAI_API_KEY | OpenAI/GPT |
| EXA_API_KEY | Exa semantic search |
| NPM_TOKEN | npm publish token |
| GITHUB_TOKEN | GitHub API |

## Rules
- NEVER add secrets to ~/.zshrc
- ALWAYS add to ~/.secrets
- NEVER commit ~/.secrets to git
`;

for (const [slug, name, category, content, desc] of [
  ["workspace-structure", "Workspace Structure", "workspace", workspaceDoc, "~/Workspace/ hierarchy and naming conventions"],
  ["secrets-schema", "Secrets Schema", "secrets_schema", secretsSchemaDoc, "Shape of ~/.secrets — keys and purpose (no actual values)"],
] as const) {
  try { getConfig(slug, db); console.log(`  = ${slug}`); }
  catch {
    const c = createConfig({ name, category, agent: "global", format: "markdown", content, kind: "reference", description: desc }, db);
    console.log(`  + ${c.slug} [${category}] (reference)`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
const stats = getConfigStats(db);
console.log("\n✓ Seed complete. DB stats:");
for (const [key, count] of Object.entries(stats)) {
  if (count > 0) console.log(`  ${key.padEnd(18)} ${count}`);
}
