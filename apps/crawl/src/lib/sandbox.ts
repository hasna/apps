import type { Page, Crawl, CreateCrawlInput } from "../types/index.js";

const SANDBOX_DB_PATH = "/tmp/crawl-sandbox.db";
const INSTALL_CRAWL_COMMAND =
  "npm install -g webcrawl 2>/dev/null || npm install -g @hasna/crawl 2>/dev/null || true";

export interface SandboxCrawlResult {
  crawl: Crawl;
  pages: Page[];
  sandboxId: string;
  durationMs: number;
}

export interface SandboxOptions {
  /** e2b API key — defaults to E2B_API_KEY env var */
  apiKey?: string;
  /** Sandbox timeout in ms (default: 5 minutes) */
  timeoutMs?: number;
  /** Stream live output to a callback */
  onOutput?: (line: string) => void;
}

/**
 * Check if e2b is available and E2B_API_KEY is set.
 */
export function checkE2B(): { available: boolean; reason?: string } {
  if (!process.env.E2B_API_KEY) {
    return { available: false, reason: "E2B_API_KEY not set" };
  }
  return { available: true };
}

export function quoteSandboxShellArg(value: string | number): string {
  const text = String(value);
  if (text.length === 0) return "''";
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function buildSandboxCommand(args: Array<string | number>): string {
  return args.map(quoteSandboxShellArg).join(" ");
}

export function buildSandboxEnv(): Record<string, string> {
  return {
    CRAWL_DB_PATH: SANDBOX_DB_PATH,
  };
}

export function buildSandboxCrawlCommand(input: CreateCrawlInput): string {
  const args: Array<string | number> = ["crawl", "crawl", input.url];

  if (input.depth !== undefined) args.push("--depth", input.depth);
  if (input.maxPages !== undefined) args.push("--max-pages", input.maxPages);
  if (input.options?.render) args.push("--render");
  if (input.options?.screenshot) args.push("--screenshot");
  if (input.options?.delay !== undefined) args.push("--delay", input.options.delay);
  args.push("--json");

  return buildSandboxCommand(args);
}

export function buildSandboxPagesCommand(crawlId: string): string {
  return buildSandboxCommand(["crawl", "pages", crawlId, "--json"]);
}

export function buildSandboxMapCommand(
  url: string,
  opts: { limit?: number; search?: string } = {}
): string {
  const args: Array<string | number> = ["crawl", "map", url];

  if (opts.limit !== undefined) args.push("--limit", opts.limit);
  if (opts.search) args.push("--search", opts.search);
  args.push("--json");

  return buildSandboxCommand(args);
}

/**
 * Run a crawl inside an isolated e2b cloud sandbox.
 * Installs webcrawl in the sandbox, runs the crawl, returns results.
 */
export async function crawlInSandbox(
  input: CreateCrawlInput,
  opts: SandboxOptions = {}
): Promise<SandboxCrawlResult> {
  const { Sandbox } = await import("e2b").catch(() => {
    throw new Error("e2b not installed. Run: bun add e2b");
  });

  const apiKey = opts.apiKey ?? process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY not set");

  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const start = Date.now();

  const sandbox = await Sandbox.create({
    apiKey,
    envs: buildSandboxEnv(),
  });

  opts.onOutput?.(`[sandbox] Created: ${sandbox.sandboxId}`);

  try {
    // Install webcrawl (or fallback to @hasna/crawl)
    opts.onOutput?.("[sandbox] Installing webcrawl...");
    const install = await sandbox.commands.run(INSTALL_CRAWL_COMMAND, { timeoutMs: 120_000 });
    opts.onOutput?.(`[sandbox] Install done (exit ${install.exitCode})`);

    const crawlCommand = buildSandboxCrawlCommand(input);
    opts.onOutput?.(`[sandbox] Running: ${crawlCommand}`);

    const crawlResult = await sandbox.commands.run(crawlCommand, {
      timeoutMs,
      onStdout: (line: string) => opts.onOutput?.(`[sandbox] ${line}`),
      onStderr: (line: string) => opts.onOutput?.(`[sandbox] stderr: ${line}`),
    });

    if (crawlResult.exitCode !== 0) {
      throw new Error(`Crawl failed (exit ${crawlResult.exitCode}): ${crawlResult.stderr}`);
    }

    // Parse crawl result from stdout
    let crawl: Crawl;
    try {
      crawl = JSON.parse(crawlResult.stdout) as Crawl;
    } catch {
      throw new Error(`Failed to parse crawl output: ${crawlResult.stdout.slice(0, 500)}`);
    }

    // Fetch pages via CLI
    opts.onOutput?.(`[sandbox] Fetching pages for crawl ${crawl.id}...`);
    const pagesResult = await sandbox.commands.run(buildSandboxPagesCommand(crawl.id), {
      timeoutMs: 30_000,
    });

    let pages: Page[] = [];
    try {
      pages = JSON.parse(pagesResult.stdout) as Page[];
    } catch {
      pages = [];
    }

    // Import pages into local DB
    opts.onOutput?.(`[sandbox] Importing ${pages.length} pages into local DB...`);
    const { createCrawl, updateCrawl } = await import("../db/crawls.js");
    const { createPage } = await import("../db/pages.js");

    const localCrawl = createCrawl({
      url: input.url,
      depth: input.depth,
      maxPages: input.maxPages,
      options: input.options,
    });

    for (const page of pages) {
      createPage({
        crawlId: localCrawl.id,
        url: page.url,
        statusCode: page.statusCode ?? undefined,
        contentType: page.contentType ?? undefined,
        title: page.title ?? undefined,
        description: page.description ?? undefined,
        textContent: page.textContent ?? undefined,
        markdownContent: page.markdownContent ?? undefined,
        metadata: page.metadata,
        wordCount: page.wordCount ?? undefined,
        byteSize: page.byteSize ?? undefined,
      });
    }

    updateCrawl(localCrawl.id, {
      status: "completed",
      pagesCrawled: pages.length,
      completedAt: new Date().toISOString(),
    });

    const { getCrawl } = await import("../db/crawls.js");
    const finalCrawl = getCrawl(localCrawl.id);

    opts.onOutput?.(`[sandbox] Done — ${pages.length} pages imported`);

    return {
      crawl: finalCrawl ?? localCrawl,
      pages,
      sandboxId: sandbox.sandboxId,
      durationMs: Date.now() - start,
    };
  } finally {
    await sandbox.kill().catch(() => {});
    opts.onOutput?.(`[sandbox] Killed sandbox ${sandbox.sandboxId}`);
  }
}

/**
 * Map a site's URLs using an e2b sandbox.
 */
export async function mapInSandbox(
  url: string,
  opts: SandboxOptions & { limit?: number; search?: string } = {}
): Promise<string[]> {
  const { Sandbox } = await import("e2b").catch(() => {
    throw new Error("e2b not installed. Run: bun add e2b");
  });

  const apiKey = opts.apiKey ?? process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY not set");

  const sandbox = await Sandbox.create({ apiKey });
  opts.onOutput?.(`[sandbox] Created: ${sandbox.sandboxId}`);

  try {
    await sandbox.commands.run(INSTALL_CRAWL_COMMAND, { timeoutMs: 120_000 });

    const result = await sandbox.commands.run(buildSandboxMapCommand(url, opts), {
      timeoutMs: opts.timeoutMs ?? 60_000,
    });

    if (result.exitCode !== 0) throw new Error(result.stderr);

    const data = JSON.parse(result.stdout) as unknown;
    if (Array.isArray(data)) return data as string[];
    return [];
  } finally {
    await sandbox.kill().catch(() => {});
  }
}
