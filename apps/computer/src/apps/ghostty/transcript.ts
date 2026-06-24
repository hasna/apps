import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../../db/index.js";
import type { PaneGrid, TerminalTranscriptSummary } from "../types.js";
import { shellQuote, type GhosttyTranscriptPlan } from "./applescript.js";

export interface GhosttyTranscriptPreparation {
  summary: TerminalTranscriptSummary;
  plan: GhosttyTranscriptPlan;
  manifestPath: string;
}

export interface CreateGhosttyTranscriptOptions {
  tabs: PaneGrid[];
  commands: (string | undefined)[];
  dir?: string;
  id?: string;
  now?: Date;
  dataDir?: string;
}

export async function createGhosttyTranscript(
  options: CreateGhosttyTranscriptOptions,
): Promise<GhosttyTranscriptPreparation | undefined> {
  const createdAt = (options.now ?? new Date()).toISOString();
  const id = options.id ?? `ghostty-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  const directory = join(options.dataDir ?? getDataDir(), "terminal-transcripts", id);
  const manifestPath = join(directory, "manifest.json");

  const panes: TerminalTranscriptSummary["panes"] = [];
  const manifestPanes: Array<Record<string, unknown>> = [];
  const plan: GhosttyTranscriptPlan = { id, panes: [] };

  let paneIndex = 0;
  for (let tabIndex = 0; tabIndex < options.tabs.length; tabIndex++) {
    const tab = options.tabs[tabIndex];
    for (let row = 0; row < tab.rows; row++) {
      for (let col = 0; col < tab.cols; col++) {
        const rawCommand = options.commands[paneIndex];
        const command = rawCommand && rawCommand.trim().length > 0
          ? rawCommand
          : options.dir
            ? `cd ${shellQuote(options.dir)}`
            : undefined;
        if (command) {
          const commandHash = sha256(command);
          const logPath = join(directory, `pane-${paneIndex}.log`);
          const statusPath = join(directory, `pane-${paneIndex}.status`);
          const marker = `${id}:pane-${paneIndex}:${commandHash.slice(0, 12)}`;
          const paneSummary = {
            paneIndex,
            tabIndex,
            row,
            col,
            commandHash,
            logPath,
            statusPath,
          };
          panes.push(paneSummary);
          plan.panes.push({ paneIndex, marker, logPath, statusPath });
          manifestPanes.push({
            ...paneSummary,
            marker,
            command,
          });
        }
        paneIndex += 1;
      }
    }
  }

  if (panes.length === 0) return undefined;

  await mkdir(directory, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: "open-computer.terminal-transcript.v1",
      id,
      app: "ghostty",
      created_at: createdAt,
      directory,
      working_directory: options.dir ?? null,
      tabs: options.tabs,
      command_count: panes.length,
      panes: manifestPanes,
    }, null, 2) + "\n",
    "utf8",
  );

  return {
    summary: {
      id,
      directory,
      manifestPath,
      commandCount: panes.length,
      panes,
    },
    plan,
    manifestPath,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
