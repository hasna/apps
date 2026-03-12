import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ConfigFilter, ExportManifest } from "../types/index.js";
import { getDatabase, now } from "../db/database.js";
import { listConfigs, getConfig } from "../db/configs.js";

export interface ExportOptions {
  filter?: ConfigFilter;
  profileId?: string;
  db?: ReturnType<typeof getDatabase>;
}

export async function exportConfigs(
  outputPath: string,
  opts: ExportOptions = {}
): Promise<{ path: string; count: number }> {
  const d = opts.db || getDatabase();
  const configs = listConfigs(opts.filter, d);

  const absOutput = resolve(outputPath);
  const tmpDir = join(tmpdir(), `configs-export-${Date.now()}`);
  const contentsDir = join(tmpDir, "contents");

  try {
    mkdirSync(contentsDir, { recursive: true });

    // Write manifest (metadata only, no content)
    const manifest: ExportManifest = {
      version: "1.0.0",
      exported_at: now(),
      configs: configs.map(({ content: _content, ...meta }) => meta),
    };
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    // Write each config content as a file
    for (const config of configs) {
      const fileName = `${config.slug}.${config.format === "text" ? "txt" : config.format}`;
      writeFileSync(join(contentsDir, fileName), config.content, "utf-8");
    }

    // Create tar.gz
    const proc = Bun.spawn(["tar", "czf", absOutput, "-C", tmpDir, "."], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`tar failed: ${stderr}`);
    }

    return { path: absOutput, count: configs.length };
  } finally {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
