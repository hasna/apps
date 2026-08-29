import type { Command } from "commander";
import chalk from "chalk";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { execSafe, spawnWithTimeout } from "../utils.js";

/** Per-effect opt-in flags for `agency new`. Every external effect (public
 * GitHub repo creation, RDS provisioning, npm publish) requires its explicit
 * flag; none happens implicitly. */
interface ScaffoldOptions {
  createRepo: boolean;
  provisionDb: boolean;
  publish: boolean;
}

/** True only when a vault-backed publish token is present in the environment
 * (NODE_AUTH_TOKEN, per the hasna/apps publish law). Ambient ~/.npmrc
 * credentials are never used by this scaffolder. */
function publishTokenAvailable(): boolean {
  return typeof process.env.NODE_AUTH_TOKEN === "string" && process.env.NODE_AUTH_TOKEN.length > 0;
}

/**
 * Scaffold templates. Reconstructed from the published @hasna/agency@0.3.1
 * bundle (2026-08-20). The legacy `open-<name>` directory naming is preserved
 * for parity; external effects (public GitHub repo creation, RDS provisioning,
 * npm publish) are gated behind explicit per-effect flags (--create-repo,
 * --provision-db, --publish) and publish additionally requires a vault-backed
 * NODE_AUTH_TOKEN. Nothing external happens implicitly.
 */

function packageJson(name: string, kind: "service" | "library"): string {
  if (kind === "library") {
    return JSON.stringify(
      {
        name: `@hasna/${name}`,
        version: "0.1.0",
        description: `TODO: describe ${name}`,
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        },
        files: ["dist", "LICENSE", "README.md"],
        scripts: {
          build: "bun build src/index.ts --outdir dist --target bun && tsc --emitDeclarationOnly --outDir dist",
          typecheck: "tsc --noEmit",
          test: "bun test",
        },
        license: "Apache-2.0",
        publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
        dependencies: {},
        devDependencies: { "@types/bun": "latest", typescript: "^5" },
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      name: `@hasna/${name}`,
      version: "0.1.0",
      description: `TODO: describe ${name}`,
      type: "module",
      main: "dist/index.js",
      types: "dist/index.d.ts",
      bin: {
        [name]: "dist/cli/index.js",
        [`${name}-mcp`]: "dist/mcp/index.js",
        [`${name}-serve`]: "dist/server/index.js",
      },
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      },
      files: ["dist", "LICENSE", "README.md"],
      scripts: {
        build: [
          `bun build src/cli/index.ts --outdir dist/cli --target bun`,
          `bun build src/mcp/index.ts --outdir dist/mcp --target bun --external @modelcontextprotocol/sdk`,
          `bun build src/server/index.ts --outdir dist/server --target bun`,
          `bun build src/index.ts --outdir dist --target bun`,
          `tsc --emitDeclarationOnly --outDir dist`,
        ].join(" && "),
        typecheck: "tsc --noEmit",
        test: "bun test",
        "dev:cli": "bun run src/cli/index.ts",
        "dev:mcp": "bun run src/mcp/index.ts",
        "dev:serve": "bun run src/server/index.ts",
      },
      license: "Apache-2.0",
      publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
      postinstall: `mkdir -p $HOME/.hasna/${name} 2>/dev/null || true`,
      dependencies: {
        "@hasna/cloud": "^0.1.7",
        "@modelcontextprotocol/sdk": "^1",
        commander: "^12",
        chalk: "^5",
        zod: "^3",
      },
      devDependencies: { "@types/bun": "latest", typescript: "^5" },
    },
    null,
    2,
  );
}

function tsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        outDir: "dist",
        rootDir: "src",
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        resolveJsonModule: true,
        isolatedModules: true,
        types: ["bun-types"],
      },
      include: ["src/**/*.ts"],
      exclude: ["node_modules", "dist", "**/*.test.ts"],
    },
    null,
    2,
  );
}

function databaseTs(name: string): string {
  return `import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable, migrateDotfile } from "@hasna/cloud";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

let _db: Database | null = null;
let _adapter: SqliteAdapter | null = null;

const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: \`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    \`,
  },
];

function getDbPath(): string {
  if (process.env["HASNA_${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]) {
    return process.env["HASNA_${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]!;
  }
  if (process.env["${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]) {
    return process.env["${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]!;
  }
  const home = homedir();
  return join(home, ".hasna", "${name}", "${name}.db");
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function runMigrations(db: Database): void {
  db.run(\`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )\`);

  for (const migration of MIGRATIONS) {
    const applied = db.query("SELECT id FROM _migrations WHERE id = ?").get(migration.id);
    if (!applied) {
      db.run("BEGIN");
      try {
        db.run(migration.sql);
        db.run("INSERT INTO _migrations (id) VALUES (?)", [migration.id]);
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    }
  }
}

export function getDatabase(): Database {
  if (_db) return _db;
  const dbPath = getDbPath();
  ensureDir(dbPath);
  _db = new Database(dbPath, { create: true });
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA foreign_keys=ON");
  _db.exec("PRAGMA busy_timeout=5000");
  runMigrations(_db);
  return _db;
}

export function getAdapter(): SqliteAdapter {
  if (_adapter) return _adapter;
  const dbPath = getDbPath();
  ensureDir(dbPath);
  _adapter = new SqliteAdapter(dbPath);
  return _adapter;
}

export function resetDatabase(): void {
  _db = null;
  _adapter = null;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  _adapter = null;
}
`;
}

function pgMigrationsTs(): string {
  return `/**
 * PostgreSQL migrations for cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: agents table
  \`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )\`,
];
`;
}

function mcpIndexTs(name: string): string {
  return `#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerCloudTools } from "@hasna/cloud";
import { getDatabase } from "../db/database.js";

const server = new McpServer({
  name: "${name}",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Agent management tools
// ---------------------------------------------------------------------------

server.tool(
  "register_agent",
  "Register or update an AI agent",
  { agent_id: z.string().describe("Unique agent identifier") },
  async ({ agent_id }) => {
    const db = getDatabase();
    const id = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    db.run(
      \`INSERT INTO agents (id, name, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET last_seen_at = excluded.last_seen_at\`,
      [id, agent_id, now],
    );
    return { content: [{ type: "text", text: \`Agent \${agent_id} registered\` }] };
  },
);

server.tool(
  "heartbeat",
  "Mark agent as active",
  { agent_id: z.string().describe("Agent identifier") },
  async ({ agent_id }) => {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE name = ?", [now, agent_id]);
    return { content: [{ type: "text", text: \`Heartbeat recorded for \${agent_id}\` }] };
  },
);

server.tool(
  "list_agents",
  "List all registered agents",
  {},
  async () => {
    const db = getDatabase();
    const agents = db.query("SELECT * FROM agents ORDER BY last_seen_at DESC").all();
    return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
  },
);

server.tool(
  "send_feedback",
  "Send feedback about the service",
  {
    agent_id: z.string().describe("Agent sending feedback"),
    message: z.string().describe("Feedback message"),
    rating: z.number().min(1).max(5).optional().describe("Rating 1-5"),
  },
  async ({ agent_id, message, rating }) => {
    return {
      content: [
        {
          type: "text",
          text: \`Feedback from \${agent_id}: \${message}\${rating ? \` (rating: \${rating})\` : ""}\`,
        },
      ],
    };
  },
);

// Register cloud sync tools
registerCloudTools(server, "${name}");

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
`;
}

function cliIndexTs(name: string): string {
  return `#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { getDatabase, closeDatabase } from "../db/database.js";
import { registerCloudCommands } from "@hasna/cloud";

const program = new Command();

program
  .name("${name}")
  .description("${name} — CLI")
  .version("0.1.0");

program
  .command("status")
  .description("Show service status")
  .action(() => {
    const db = getDatabase();
    const agents = db.query("SELECT COUNT(*) as count FROM agents").get() as { count: number };
    console.log(chalk.bold("${name} status\\n"));
    console.log(\`  Agents: \${agents.count}\`);
    closeDatabase();
  });

program
  .command("feedback <message>")
  .description("Send feedback")
  .option("--rating <n>", "Rating 1-5", parseInt)
  .action((message: string, opts: { rating?: number }) => {
    console.log(chalk.green("Feedback recorded:"), message);
    if (opts.rating) console.log(chalk.dim(\`  Rating: \${opts.rating}/5\`));
  });

// Register cloud sync/push/pull commands
registerCloudCommands(program, "${name}");

program.parse();
`;
}

function serverIndexTs(name: string): string {
  return `#!/usr/bin/env bun
/**
 * HTTP server for ${name}.
 * Usage: ${name}-serve [--port 3000]
 */

import { getDatabase } from "../db/database.js";

const DEFAULT_PORT = 3000;

function parsePort(): number {
  const portArg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (portArg) {
    if (portArg.includes("=")) {
      return parseInt(portArg.split("=")[1]!, 10) || DEFAULT_PORT;
    }
    const idx = process.argv.indexOf(portArg);
    return parseInt(process.argv[idx + 1]!, 10) || DEFAULT_PORT;
  }
  return DEFAULT_PORT;
}

const port = parsePort();

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "${name}", timestamp: new Date().toISOString() });
    }

    if (url.pathname === "/api/agents") {
      const db = getDatabase();
      const agents = db.query("SELECT * FROM agents ORDER BY last_seen_at DESC").all();
      return Response.json(agents);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(\`${name}-serve listening on http://localhost:\${server.port}\`);
`;
}

function libIndexTs(name: string): string {
  return `// ---------------------------------------------------------------------------
// @hasna/${name} — Library exports
// ---------------------------------------------------------------------------

export { getDatabase, closeDatabase, resetDatabase } from "./db/database.js";
`;
}

function readmeTemplate(name: string, kind: "service" | "library"): string {
  if (kind === "library") {
    return `# @hasna/${name}

TODO: describe ${name}.

## Install

\`\`\`bash
bun install @hasna/${name}
\`\`\`

## License

Apache-2.0
`;
  }
  return `# @hasna/${name}

TODO: describe ${name}.

## Install

\`\`\`bash
bun install -g @hasna/${name}
\`\`\`

## Usage

### CLI

\`\`\`bash
${name} status
${name} feedback "Great service!"
\`\`\`

### MCP Server

\`\`\`bash
${name}-mcp
\`\`\`

### HTTP Server

\`\`\`bash
${name}-serve --port 3000
\`\`\`

## License

Apache-2.0
`;
}

const APACHE_LICENSE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work.

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to the Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by the Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding any notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   Copyright 2024 Hasna

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
`;

function ensureDir2(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createSetupTasks(name: string, dir: string): void {
  console.log(chalk.dim("  Creating setup tasks from template..."));
  const initResult = execSafe(`bun -e "const { initBuiltinTemplates } = require('@hasna/todos'); initBuiltinTemplates(); console.log('ok');" 2>/dev/null`, 15000);
  if (initResult !== null && initResult.includes("ok")) {
    console.log(chalk.dim("  Builtin templates initialized."));
  }
  const projectResult = execSafe(`todos --json projects --add "${dir}" --name "${name}" 2>/dev/null`, 15000);
  let projectId: string | null = null;
  if (projectResult !== null) {
    try {
      const project = JSON.parse(projectResult);
      projectId = project.id;
      console.log(chalk.dim(`  Todos project created: ${project.name} (${project.id.slice(0, 8)})`));
    } catch {
      console.log(chalk.yellow("  Could not parse todos project output."));
    }
  } else {
    console.log(chalk.yellow("  todos CLI not available — skipping setup tasks."));
    return;
  }
  if (!projectId) {
    console.log(chalk.yellow("  Could not create todos project — skipping setup tasks."));
    return;
  }
  const templatesResult = execSafe(`todos --json templates 2>/dev/null`, 15000);
  let templateId: string | null = null;
  if (templatesResult !== null) {
    try {
      const templates = JSON.parse(templatesResult);
      const osTemplate = templates.find((t: { name: string }) => t.name === "open-source-project");
      if (osTemplate) {
        templateId = osTemplate.id;
      }
    } catch {
      /* ignore */
    }
  }
  if (!templateId) {
    console.log(chalk.yellow("  open-source-project template not found — skipping setup tasks."));
    return;
  }
  const escapedName = name.replace(/'/g, "\\'");
  const tasksResult = execSafe(
    `bun -e "const { tasksFromTemplate } = require('@hasna/todos'); const tasks = tasksFromTemplate('${templateId}', '${projectId}', { name: '${escapedName}', org: 'hasna' }); console.log(JSON.stringify({ count: tasks.length }));" 2>/dev/null`,
    15000,
  );
  if (tasksResult !== null) {
    try {
      const result = JSON.parse(tasksResult);
      console.log(chalk.green(`  Created ${result.count} setup tasks from open-source-project template.`));
    } catch {
      console.log(chalk.yellow("  Tasks may have been created (could not parse output)."));
    }
  } else {
    console.log(chalk.yellow("  Could not create tasks from template — run manually."));
  }
}

async function scaffoldService(name: string, baseDir: string, skipTasks: boolean, opts: ScaffoldOptions): Promise<void> {
  const dir = join(baseDir, `open-${name}`);
  console.log(chalk.bold(`\nagency new service ${name}\n`));
  if (existsSync(dir)) {
    console.error(chalk.red(`  Directory already exists: ${dir}`));
    process.exit(1);
  }
  console.log(chalk.dim("  Creating directory structure..."));
  ensureDir2(dir);
  ensureDir2(join(dir, "src", "db"));
  ensureDir2(join(dir, "src", "mcp"));
  ensureDir2(join(dir, "src", "cli"));
  ensureDir2(join(dir, "src", "server"));
  console.log(chalk.dim("  Generating files..."));
  writeFileSync(join(dir, "package.json"), packageJson(name, "service"));
  writeFileSync(join(dir, "tsconfig.json"), tsconfig());
  writeFileSync(join(dir, "LICENSE"), APACHE_LICENSE);
  writeFileSync(join(dir, "README.md"), readmeTemplate(name, "service"));
  writeFileSync(join(dir, "src", "index.ts"), libIndexTs(name));
  writeFileSync(join(dir, "src", "db", "database.ts"), databaseTs(name));
  writeFileSync(join(dir, "src", "db", "pg-migrations.ts"), pgMigrationsTs());
  writeFileSync(join(dir, "src", "mcp", "index.ts"), mcpIndexTs(name));
  writeFileSync(join(dir, "src", "cli", "index.ts"), cliIndexTs(name));
  writeFileSync(join(dir, "src", "server", "index.ts"), serverIndexTs(name));
  writeFileSync(
    join(dir, ".gitignore"),
    `node_modules/
dist/
*.db
*.db-journal
*.db-wal
.secrets/
`,
  );
  console.log(chalk.green("  Files generated."));
  console.log(chalk.dim("  Installing dependencies..."));
  const installResult = execSafe(`cd "${dir}" && bun install 2>&1`, 60000);
  if (installResult !== null) {
    console.log(chalk.green("  Dependencies installed."));
  } else {
    console.log(chalk.yellow("  bun install failed — run manually."));
  }
  console.log(chalk.dim("  Initializing git..."));
  execSafe(`cd "${dir}" && git init && git add -A && git commit -m "feat: scaffold ${name}" 2>&1`, 15000);
  if (opts.createRepo) {
    console.log(chalk.dim("  Creating GitHub repo..."));
    const ghResult = execSafe(`cd "${dir}" && gh repo create hasna/${name} --public --source . --push --description "TODO: describe ${name}" 2>&1`, 30000);
    if (ghResult !== null) {
      console.log(chalk.green(`  GitHub repo created: https://github.com/hasna/${name}`));
    } else {
      console.log(chalk.yellow("  GitHub repo creation failed — create manually."));
    }
  } else {
    console.log(chalk.dim("  Skipping GitHub repo creation (pass --create-repo to create hasna/" + name + " on GitHub)."));
  }
  if (opts.provisionDb) {
    console.log(chalk.dim("  Creating RDS database..."));
    const pgHost = process.env["CLOUD_PG_HOST"] || process.env["HASNA_RDS_HOST"];
    const pgUser = process.env["CLOUD_PG_USER"] || process.env["HASNA_RDS_USER"] || "hasna_admin";
    const pgPassword = process.env["CLOUD_PG_PASSWORD"] || process.env["HASNA_RDS_PASSWORD"] || "";
    const dbName = name.replace(/-/g, "_");
    if (pgHost && pgPassword) {
      // Credentials via child env, connection fields via argv — never a shell
      // command string (no process-argument secret exposure).
      const createDbResult = await spawnWithTimeout(
        "psql",
        ["-h", pgHost, "-U", pgUser, "-d", "postgres", "-c", `CREATE DATABASE ${dbName};`],
        15000,
        { PGPASSWORD: pgPassword },
      );
      if (createDbResult.code === 0 && !createDbResult.stderr.includes("ERROR")) {
        console.log(chalk.green(`  RDS database created: ${dbName}`));
      } else {
        console.log(chalk.yellow(`  RDS database creation skipped (may already exist or failed).`));
      }
    } else {
      console.log(chalk.yellow("  RDS not configured — skipping database creation."));
    }
  } else {
    console.log(chalk.dim("  Skipping RDS database provisioning (pass --provision-db to enable)."));
  }
  if (opts.publish) {
    if (!publishTokenAvailable()) {
      console.log(chalk.yellow("  Skipping npm publish: NODE_AUTH_TOKEN is not set — publish manually with a vault-backed token (secrets exec ... --as NODE_AUTH_TOKEN -- npm publish --userconfig <tmp npmrc>)."));
    } else {
      console.log(chalk.dim("  Publishing to npm..."));
      const buildResult = execSafe(`cd "${dir}" && bun run build 2>&1`, 30000);
      if (buildResult !== null) {
        const npmrcPath = join(dir, ".agency-scaffold-npmrc");
        try {
          writeFileSync(npmrcPath, "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n", { mode: 0o600 });
          const publishResult = execSafe(`cd "${dir}" && npm publish --userconfig "${npmrcPath}" --access public 2>&1`, 30000);
          if (publishResult !== null) {
            console.log(chalk.green(`  Published @hasna/${name}@0.1.0`));
          } else {
            console.log(chalk.yellow("  npm publish failed — publish manually."));
          }
        } finally {
          try {
            unlinkSync(npmrcPath);
          } catch {
            /* best-effort cleanup */
          }
        }
      } else {
        console.log(chalk.yellow("  Build failed — publish manually."));
      }
    }
  } else {
    console.log(chalk.dim("  Skipping npm publish (pass --publish to build and publish)."));
  }
  if (!skipTasks) {
    createSetupTasks(name, dir);
  } else {
    console.log(chalk.dim("  Skipping setup tasks (--skip-tasks)."));
  }
  console.log(chalk.bold.green(`\n  open-${name} scaffolded successfully.\n`));
  console.log(chalk.dim(`  Directory: ${dir}`));
  console.log(chalk.dim(`  Package:   @hasna/${name}`));
  console.log(chalk.dim(`  CLI:       ${name}`));
  console.log(chalk.dim(`  MCP:       ${name}-mcp`));
  console.log(chalk.dim(`  Server:    ${name}-serve`));
}

async function scaffoldLibrary(name: string, baseDir: string, skipTasks: boolean, opts: ScaffoldOptions): Promise<void> {
  const dir = join(baseDir, `open-${name}`);
  console.log(chalk.bold(`\nagency new library ${name}\n`));
  if (existsSync(dir)) {
    console.error(chalk.red(`  Directory already exists: ${dir}`));
    process.exit(1);
  }
  console.log(chalk.dim("  Creating directory structure..."));
  ensureDir2(dir);
  ensureDir2(join(dir, "src"));
  console.log(chalk.dim("  Generating files..."));
  writeFileSync(join(dir, "package.json"), packageJson(name, "library"));
  writeFileSync(join(dir, "tsconfig.json"), tsconfig());
  writeFileSync(join(dir, "LICENSE"), APACHE_LICENSE);
  writeFileSync(join(dir, "README.md"), readmeTemplate(name, "library"));
  writeFileSync(
    join(dir, "src", "index.ts"),
    `// ---------------------------------------------------------------------------
// @hasna/${name} — Library exports
// ---------------------------------------------------------------------------

export {};
`,
  );
  writeFileSync(
    join(dir, ".gitignore"),
    `node_modules/
dist/
.secrets/
`,
  );
  console.log(chalk.green("  Files generated."));
  console.log(chalk.dim("  Installing dependencies..."));
  const installResult = execSafe(`cd "${dir}" && bun install 2>&1`, 60000);
  if (installResult !== null) {
    console.log(chalk.green("  Dependencies installed."));
  } else {
    console.log(chalk.yellow("  bun install failed — run manually."));
  }
  console.log(chalk.dim("  Initializing git..."));
  execSafe(`cd "${dir}" && git init && git add -A && git commit -m "feat: scaffold ${name}" 2>&1`, 15000);
  if (opts.createRepo) {
    console.log(chalk.dim("  Creating GitHub repo..."));
    const ghResult = execSafe(`cd "${dir}" && gh repo create hasna/${name} --public --source . --push --description "TODO: describe ${name}" 2>&1`, 30000);
    if (ghResult !== null) {
      console.log(chalk.green(`  GitHub repo created: https://github.com/hasna/${name}`));
    } else {
      console.log(chalk.yellow("  GitHub repo creation failed — create manually."));
    }
  } else {
    console.log(chalk.dim("  Skipping GitHub repo creation (pass --create-repo to create hasna/" + name + " on GitHub)."));
  }
  if (opts.publish) {
    if (!publishTokenAvailable()) {
      console.log(chalk.yellow("  Skipping npm publish: NODE_AUTH_TOKEN is not set — publish manually with a vault-backed token (secrets exec ... --as NODE_AUTH_TOKEN -- npm publish --userconfig <tmp npmrc>)."));
    } else {
      console.log(chalk.dim("  Publishing to npm..."));
      const buildResult = execSafe(`cd "${dir}" && bun run build 2>&1`, 30000);
      if (buildResult !== null) {
        const npmrcPath = join(dir, ".agency-scaffold-npmrc");
        try {
          writeFileSync(npmrcPath, "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n", { mode: 0o600 });
          const publishResult = execSafe(`cd "${dir}" && npm publish --userconfig "${npmrcPath}" --access public 2>&1`, 30000);
          if (publishResult !== null) {
            console.log(chalk.green(`  Published @hasna/${name}@0.1.0`));
          } else {
            console.log(chalk.yellow("  npm publish failed — publish manually."));
          }
        } finally {
          try {
            unlinkSync(npmrcPath);
          } catch {
            /* best-effort cleanup */
          }
        }
      } else {
        console.log(chalk.yellow("  Build failed — publish manually."));
      }
    }
  } else {
    console.log(chalk.dim("  Skipping npm publish (pass --publish to build and publish)."));
  }
  if (!skipTasks) {
    createSetupTasks(name, dir);
  } else {
    console.log(chalk.dim("  Skipping setup tasks (--skip-tasks)."));
  }
  console.log(chalk.bold.green(`\n  open-${name} scaffolded successfully.\n`));
  console.log(chalk.dim(`  Directory: ${dir}`));
  console.log(chalk.dim(`  Package:   @hasna/${name}`));
}

export function registerNewCommand(program: Command): void {
  const newCmd = program.command("new").description("Scaffold a new @hasna/* package (service or library)");

  newCmd
    .command("service <name>")
    .description("Create a new service with CLI, MCP server, HTTP server, and database")
    .option("-d, --dir <path>", "Base directory for the new project", process.cwd())
    .option("--skip-tasks", "Skip creating setup tasks from the open-source-project template")
    .option("--create-repo", "Create a public GitHub repository (gh repo create --public --push) for the scaffold")
    .option("--provision-db", "Provision an RDS database for the service")
    .option("--publish", "Build and publish the package to npm (requires NODE_AUTH_TOKEN)")
    .action(async (name: string, opts) => {
      const baseDir = resolve(opts.dir);
      await scaffoldService(name, baseDir, !!opts.skipTasks, {
        createRepo: !!opts.createRepo,
        provisionDb: !!opts.provisionDb,
        publish: !!opts.publish,
      });
    });

  newCmd
    .command("library <name>")
    .description("Create a new library package (no DB, MCP, CLI, or server)")
    .option("-d, --dir <path>", "Base directory for the new project", process.cwd())
    .option("--skip-tasks", "Skip creating setup tasks from the open-source-project template")
    .option("--create-repo", "Create a public GitHub repository (gh repo create --public --push) for the scaffold")
    .option("--publish", "Build and publish the package to npm (requires NODE_AUTH_TOKEN)")
    .action(async (name: string, opts) => {
      const baseDir = resolve(opts.dir);
      await scaffoldLibrary(name, baseDir, !!opts.skipTasks, {
        createRepo: !!opts.createRepo,
        provisionDb: false,
        publish: !!opts.publish,
      });
    });
}
