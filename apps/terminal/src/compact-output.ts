export const DEFAULT_LIST_LIMIT = 10;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_TEXT_LIMIT = 120;

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function getFlagValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

export function parseLimit(args: string[], fallback: number = DEFAULT_LIST_LIMIT): number {
  const raw = getFlagValue(args, "--limit");
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

export function truncateText(value: unknown, max: number = DEFAULT_TEXT_LIMIT): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

export function compactPath(value: string, maxSegments: number = 3): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= maxSegments) return value;
  return `.../${parts.slice(-maxSegments).join("/")}`;
}

export function compactLines(content: string, maxLines: number = 80, maxChars: number = 6000): {
  content: string;
  lineCount: number;
  truncated: boolean;
} {
  const lines = content.split("\n");
  let visible = lines.slice(0, maxLines).join("\n");
  let truncated = lines.length > maxLines;
  if (visible.length > maxChars) {
    visible = visible.slice(0, maxChars);
    truncated = true;
  }
  return { content: visible, lineCount: lines.length, truncated };
}

export function formatMoreHint(showing: number, total: number, detail: string): string | null {
  if (total <= showing) return null;
  return `Showing ${showing} of ${total}. ${detail}`;
}

export function compactRecipe(recipe: any, verbose = false): Record<string, unknown> {
  return {
    name: recipe.name,
    collection: recipe.collection ?? null,
    scope: recipe.project ? "project" : recipe.id?.startsWith("sys-") ? "system" : "global",
    description: recipe.description ? truncateText(recipe.description, verbose ? 240 : 80) : undefined,
    command: verbose ? recipe.command : truncateText(recipe.command, 120),
    variables: Array.isArray(recipe.variables) ? recipe.variables.map((v: any) => v.name) : [],
    tags: Array.isArray(recipe.tags) ? recipe.tags.slice(0, verbose ? recipe.tags.length : 5) : [],
  };
}

export function compactCollection(collection: any): Record<string, unknown> {
  return {
    name: collection.name,
    scope: collection.project ? "project" : "global",
    description: collection.description ? truncateText(collection.description, 100) : undefined,
  };
}

export function compactSession(session: any): Record<string, unknown> {
  return {
    id: session.id,
    startedAt: session.started_at,
    cwd: compactPath(session.cwd ?? ""),
    provider: session.provider ?? "auto",
    model: session.model ?? null,
  };
}

export function compactInteraction(interaction: any, verbose = false): Record<string, unknown> {
  return {
    id: interaction.id,
    status: interaction.exit_code === 0 ? "ok" : interaction.exit_code ? "error" : "unknown",
    prompt: verbose ? interaction.nl : truncateText(interaction.nl, 100),
    command: interaction.command ? (verbose ? interaction.command : truncateText(interaction.command, 120)) : null,
    tokensSaved: interaction.tokens_saved ?? 0,
    createdAt: interaction.created_at,
  };
}

export function compactEnv(env: Record<string, unknown> | undefined, verbose = false): Record<string, unknown> {
  const names = Object.keys(env ?? {}).sort();
  return {
    names: names.slice(0, verbose ? 50 : 6),
    total: names.length,
    values: "redacted",
  };
}

export function compactSnapshot(snapshot: any, verbose = false): Record<string, unknown> {
  const recentCommands = Array.isArray(snapshot.recentCommands) ? snapshot.recentCommands : [];
  const processes = Array.isArray(snapshot.runningProcesses) ? snapshot.runningProcesses : [];
  const recipes = Array.isArray(snapshot.recipes) ? snapshot.recipes : [];
  return {
    cwd: snapshot.cwd,
    env: compactEnv(snapshot.env, verbose),
    runningProcesses: processes.slice(0, verbose ? 20 : 5).map(compactManagedProcess),
    recentCommands: recentCommands.slice(0, verbose ? 20 : 5).map((cmd: any) => ({
      cmd: verbose ? cmd.cmd : truncateText(cmd.cmd, 120),
      intent: cmd.intent ? truncateText(cmd.intent, 100) : undefined,
      exitCode: cmd.exitCode,
    })),
    recipes: recipes.slice(0, verbose ? 20 : 5).map((recipe: any) => ({
      name: recipe.name,
      command: verbose ? recipe.command : truncateText(recipe.command, 100),
    })),
    economy: snapshot.economy,
    totals: {
      runningProcesses: processes.length,
      recentCommands: recentCommands.length,
      recipes: recipes.length,
    },
    timestamp: snapshot.timestamp,
  };
}

export function compactManagedProcess(processInfo: any): Record<string, unknown> {
  const output = Array.isArray(processInfo.lastOutput) ? processInfo.lastOutput : [];
  return {
    pid: processInfo.pid,
    command: truncateText(processInfo.command, 120),
    cwd: processInfo.cwd ? compactPath(processInfo.cwd) : undefined,
    port: processInfo.port,
    uptimeMs: processInfo.startedAt ? Date.now() - processInfo.startedAt : undefined,
    exitCode: processInfo.exitCode,
    lastOutput: output.slice(-3).map((line: string) => truncateText(line, 160)),
  };
}

export function compactSearchResult(result: any, limit: number): Record<string, unknown> {
  if (Array.isArray(result?.symbols)) {
    return {
      ...result,
      symbols: result.symbols.slice(0, limit),
      returned: Math.min(result.symbols.length, limit),
      hint: result.symbols.length > limit ? `Use maxResults or a narrower query for more than ${limit} symbols.` : undefined,
    };
  }
  if (Array.isArray(result?.files)) {
    return {
      ...result,
      files: result.files.slice(0, limit),
      returned: Math.min(result.files.length, limit),
      hint: result.files.length > limit ? `Use maxResults, offset, or a narrower pattern for more than ${limit} files.` : undefined,
    };
  }
  return result;
}

export function formatRecipeList(recipes: any[], total: number, verbose = false): string {
  const lines = recipes.map((recipe) => {
    const item = compactRecipe(recipe, verbose);
    const collection = item.collection ? ` [${item.collection}]` : "";
    const vars = Array.isArray(item.variables) && item.variables.length > 0 ? ` vars:${item.variables.join(",")}` : "";
    return `  ${item.name}${collection} (${item.scope})${vars} - ${item.command}`;
  });
  const hint = formatMoreHint(recipes.length, total, "Use --limit=N, --verbose, or recipe show <name> for details.");
  if (hint) lines.push(`\n${hint}`);
  else lines.push("\nUse recipe show <name> for full command details.");
  return lines.join("\n");
}

export function formatCollectionList(collections: any[], total: number): string {
  const lines = collections.map((collection) => {
    const item = compactCollection(collection);
    return `  ${item.name} (${item.scope})${item.description ? ` - ${item.description}` : ""}`;
  });
  const hint = formatMoreHint(collections.length, total, "Use --limit=N or --json for more.");
  if (hint) lines.push(`\n${hint}`);
  return lines.join("\n");
}

export function formatSnapshot(snapshot: any, verbose = false): string {
  const compact = compactSnapshot(snapshot, verbose);
  const lines = [
    `Snapshot: ${compact.cwd}`,
    `  Processes: ${(compact.totals as any).runningProcesses}`,
    `  Recent commands: ${(compact.totals as any).recentCommands}`,
    `  Recipes: ${(compact.totals as any).recipes}`,
    `  Tokens saved: ${(compact.economy as any)?.tokensSaved ?? "0"}`,
  ];
  const processes = compact.runningProcesses as any[];
  if (processes.length > 0) {
    lines.push("  Running:");
    for (const processInfo of processes) lines.push(`    ${processInfo.pid} ${processInfo.command}`);
  }
  const recentCommands = compact.recentCommands as any[];
  if (recentCommands.length > 0) {
    lines.push("  Recent:");
    for (const command of recentCommands) lines.push(`    ${command.cmd}`);
  }
  lines.push("Use snapshot --json for the full machine-readable snapshot.");
  return lines.join("\n");
}
