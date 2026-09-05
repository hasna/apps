import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");
const prose = readme.replace(/\s+/g, " ");

describe("canonical client documentation", () => {
  test("installs without lifecycle-created application state and configures the API", () => {
    const install = readme.split("## Install\n")[1]?.split("\n## ")[0] ?? "";
    expect(install).toContain("--ignore-scripts");
    expect(readme).toContain("HASNA_EMAILS_API_URL");
    expect(readme).toContain("HASNA_EMAILS_API_KEY");
    expect(readme).toContain("EMAILS_SESSION_TOKEN");
    expect(readme).toContain("EMAILS_IDP_TOKEN");
  });

  test("does not instruct clients to select a retired mode or use local SQLite", () => {
    expect(readme).not.toMatch(/^(?:export\s+)?(?:HASNA_)?EMAILS_MODE=/m);
    expect(readme).not.toMatch(/must\s+select\s+`self_hosted`/);
    expect(readme).not.toContain("`local` by default");
    expect(readme).not.toContain("unset or blank means\nlocal SQLite");
    expect(readme).toContain("Remove retired selector variables");
    expect(prose.includes("Client database settings are rejected")).toBe(true);
    expect(readme).toContain("blank or conflicting aliases");
  });

  test("keeps service setup separate and documents the lack of automatic data migration", () => {
    expect(readme).toContain("HASNA_EMAILS_DATABASE_URL");
    expect(readme).toContain("no SQLite fallback");
    expect(readme).toContain("No existing database or attachment directory is deleted or migrated");
    expect(readme).toContain("Raw library storage helpers");
    expect(readme).not.toMatch(/^curl ['"]?localhost:3900\/api\//m);
  });

  test("does not recommend refused credential writes or server-only inbox commands", () => {
    const shellExamples = [...readme.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map(match => match[1]!).join("\n");
    expect(/emails provider add[^\n]*--(?:api|access|secret)-key\b/.test(shellExamples)).toBe(false);
    expect(/^emails inbox (?:sync-s3|setup-realtime|realtime-status|watch|listen|explain)\b/m.test(shellExamples)).toBe(false);
    expect(prose.includes("Provider credentials are configured on the service")).toBe(true);
    expect(prose.includes("These client commands intentionally refuse")).toBe(true);
    expect(readme.includes("emails-serve ingest-worker")).toBe(true);
  });
});

const root = join(import.meta.dir, "..");
const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
const plan = readFileSync(join(root, "docs", "PLAN-MODE-REMOVAL.md"), "utf8");
const historyStart = "<!-- historical-record:start -->\n";
const historyEnd = "<!-- historical-record:end -->";
const historicalDigest = "a2f827548a0accaa97fcf51f2de72cce2255f4cf6ac6ca0ebb155a72820e9e17";

function section(document: string, title: string): string {
  const parts = document.split(`## ${title}\n`);
  if (parts.length !== 2) throw new Error(`Expected exactly one ${title} section`);
  const value = parts[1]!.split("\n## ")[0]!.trim();
  if (!value) throw new Error(`Empty ${title} section`);
  return value;
}

function planParts(document: string): { current: string; historical: string } {
  const starts = document.split(historyStart);
  if (starts.length !== 2) throw new Error("Expected one historical start marker");
  const ends = starts[1]!.split(historyEnd);
  if (ends.length !== 2 || !ends[0]!.trim()) throw new Error("Expected one nonempty historical record");
  return { current: starts[0]! + ends[1]!, historical: ends[0]! };
}

function preservedHistory(document: string): string {
  const { historical } = planParts(document);
  if (createHash("sha256").update(historical).digest("hex") !== historicalDigest) {
    throw new Error("Historical program evidence changed");
  }
  return historical;
}

// Run the same checks over the real documents and deterministic corrupted copies.
function currentClientFailures(document: string): string[] {
  const current = section(document, "Current client contract").replace(/\s+/g, " ");
  const required = ["authenticated HTTPS", "HASNA_EMAILS_API_URL", "HASNA_EMAILS_API_KEY",
    "EMAILS_SESSION_TOKEN", "EMAILS_IDP_TOKEN", "No implicit client SQLite fallback",
    "blank or conflicting aliases", "Client database settings are rejected"];
  const obsolete = ["Neither → the default local SQLite path", "credentials are stored in the local DB"];
  return [...required.filter(value => !current.includes(value)), ...obsolete.filter(value => current.includes(value))];
}

function currentPlanFailures(document: string): string[] {
  const { current } = planParts(document);
  const prose = current.replace(/\s+/g, " ");
  const required = ["Configured clients use authenticated HTTPS only", "PostgreSQL is server-side storage, never a client transport",
    "historical default-SQLite target is superseded", "explicit SQLite adapters", "not release acceptance",
    "dashboard", "tracking", "public listeners", "TUI preference writes", "provider-filtered reports"];
  const obsolete = ["Neither → the default local SQLite path", "exactly TWO client stores, forever"];
  return [...required.filter(value => !prose.includes(value)), ...obsolete.filter(value => prose.includes(value))];
}

function workflow(document: string, title: string): string {
  const parts = section(document, "Workflows").split(`### ${title}\n`);
  if (parts.length !== 2) throw new Error(`Expected exactly one ${title} workflow`);
  const value = parts[1]!.split("\n### ")[0]!.trim();
  if (!value) throw new Error(`Empty ${title} workflow`);
  return value;
}

function workflowFailures(document: string): string[] {
  const bulk = workflow(document, "Bulk campaign");
  const drip = workflow(document, "Drip sequence");
  const failures: string[] = [];
  for (const [name, value, required] of [
    ["bulk", bulk, ["`batch_send` is unavailable on the canonical client", "remaining service-contract work", "[UNAVAILABLE] batch_send("]],
    ["drip", drip, ["`emails schedule run` and `emails scheduler` are unavailable on the canonical client", "remaining service-contract work", "[UNAVAILABLE] Process due steps"]],
  ] as const) {
    const prose = value.replace(/\s+/g, " ");
    for (const phrase of required) if (!prose.includes(phrase)) failures.push(`${name}: ${phrase}`);
  }
  if (/^\s*\d+\.\s*batch_send\(/m.test(bulk)) failures.push("actionable batch step");
  if (/^\s*(?:#\s*)?(?:\d+\.\s*)?Run\b[^\n]*(?:emails scheduler|daemon\/reconciler)/im.test(drip)
    || /^\s*\d+\.\s*`?emails (?:schedule run|scheduler)\b/m.test(drip)) failures.push("actionable scheduler step");
  return failures;
}

function nodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function batchRefuses(source: string): boolean {
  const file = ts.createSourceFile("misc-ops.ts", source, ts.ScriptTarget.Latest, true);
  const calls = nodes(file, ts.isCallExpression).filter(call =>
    ts.isPropertyAccessExpression(call.expression) && call.expression.getText(file) === "server.tool"
    && ts.isStringLiteral(call.arguments[0]!) && call.arguments[0]!.text === "batch_send");
  if (calls.length !== 1) throw new Error("Expected one batch tool registration");
  const handler = calls[0]!.arguments[3];
  if (!handler || !ts.isArrowFunction(handler) || !ts.isBlock(handler.body) || handler.body.statements.length !== 1) return false;
  const statement = handler.body.statements[0]!;
  if (!ts.isReturnStatement(statement) || !statement.expression || !ts.isObjectLiteralExpression(statement.expression)) return false;
  const flags = statement.expression.properties.filter(property =>
    ts.isPropertyAssignment(property) && property.name.getText(file) === "isError");
  return flags.length === 1 && ts.isPropertyAssignment(flags[0]!) && flags[0]!.initializer.kind === ts.SyntaxKind.TrueKeyword;
}

function schedulerRefuses(source: string, receiver: string, command: string, refusal: string): boolean {
  const file = ts.createSourceFile("misc.remote.ts", source, ts.ScriptTarget.Latest, true);
  const actions = nodes(file, ts.isCallExpression).filter(call => {
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "action") return false;
    let chain: ts.Expression = call.expression.expression;
    while (ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression)) {
      const method = chain.expression;
      if (method.name.text === "command" && method.expression.getText(file) === receiver
        && chain.arguments[0] && ts.isStringLiteral(chain.arguments[0]) && chain.arguments[0].text === command) return true;
      chain = method.expression;
    }
    return false;
  });
  if (actions.length !== 1) throw new Error("Expected one scheduler action registration");
  const handler = actions[0]!.arguments[0];
  if (!handler || !ts.isArrowFunction(handler) || !ts.isBlock(handler.body) || handler.body.statements.length !== 1) return false;
  const statement = handler.body.statements[0]!;
  if (!ts.isTryStatement(statement) || statement.tryBlock.statements.length !== 1) return false;
  const action = statement.tryBlock.statements[0]!;
  if (!ts.isExpressionStatement(action) || !ts.isCallExpression(action.expression)) return false;
  const call = action.expression;
  if (call.expression.getText(file) !== "serverOnly" || call.arguments.length !== 1
    || !ts.isStringLiteral(call.arguments[0]!) || call.arguments[0]!.text !== refusal) return false;
  const helpers = nodes(file, ts.isFunctionDeclaration).filter(node => node.name?.text === "serverOnly");
  return helpers.length === 1 && helpers[0]!.body?.statements.length === 1
    && ts.isThrowStatement(helpers[0]!.body!.statements[0]!);
}

describe("canonical agent and source-plan guidance", () => {
  test("labels unavailable bulk and due-step execution at the actual workflow steps", () => {
    expect(workflowFailures(agents)).toEqual([]);
    expect(workflowFailures(agents.replace("[UNAVAILABLE] batch_send(", "batch_send("))).toContain("actionable batch step");
    const oldScheduler = "# Run `emails scheduler` or the daemon/reconciler flow to process due steps";
    expect(workflowFailures(agents.replace("### Drip sequence\n", `### Drip sequence\n${oldScheduler}\n`))).toContain("actionable scheduler step");
    for (const title of ["Bulk campaign", "Drip sequence"]) {
      const current = workflow(agents, title);
      expect(workflowFailures(agents.replace(current, current.replace("remaining service-contract work", "complete"))).length).toBeGreaterThan(0);
      expect(() => workflowFailures(agents.replace(`### ${title}\n`, "### Missing workflow\n"))).toThrow();
      expect(() => workflowFailures(agents.replace(`### ${title}\n`, `### ${title}\nduplicate\n### ${title}\n`))).toThrow();
    }
  });

  test("binds workflow limitations to registered handlers, not descriptions or error prose", () => {
    const batch = readFileSync(join(root, "src/mcp/tools/misc-ops.ts"), "utf8");
    expect(batchRefuses(batch)).toBe(true);
    expect(batchRefuses(batch.replace(/isError: true/g, "isError: false"))).toBe(false);
    expect(() => batchRefuses(batch.replace('"batch_send",', '"other_tool",'))).toThrow();
    const scheduler = readFileSync(join(root, "src/cli/commands/misc.remote.ts"), "utf8");
    for (const [receiver, command, refusal] of [["scheduleCmd", "run", "emails schedule run"], ["program", "scheduler", "emails scheduler"]] as const) {
      expect(schedulerRefuses(scheduler, receiver, command, refusal)).toBe(true);
      expect(schedulerRefuses(scheduler.replace(`try { serverOnly("${refusal}");`, `try { otherHandler("${refusal}");`), receiver, command, refusal)).toBe(false);
      expect(schedulerRefuses(scheduler.replace("throw new Error(", "return new Error("), receiver, command, refusal)).toBe(false);
      expect(() => schedulerRefuses(scheduler, receiver, "absent-command", refusal)).toThrow();
    }
  });

  test("binds current setup instructions to the actual HTTP factory and PostgreSQL service", () => {
    expect(currentClientFailures(agents)).toEqual([]);
    const resolver = readFileSync(join(root, "src", "store-resolution.ts"), "utf8");
    expect(resolver).toMatch(/export function createConfiguredEmailStore\(\)[\s\S]*return createHttpEmailStore\(/);
    expect(resolver).not.toMatch(/import[^;]*store-sqlite/);
    const service = section(agents, "Current service contract");
    expect(service).toContain("HASNA_EMAILS_DATABASE_URL");
    expect(service).toContain("EMAILS_DATABASE_URL");
    expect(service).toContain("server-side PostgreSQL");
    expect(service).toContain("not the legacy dashboard");
    const backend = readFileSync(join(root, "src", "server", "storage-backend.ts"), "utf8");
    expect(backend).toContain('return "postgresql"');
    expect(backend).not.toContain('return "sqlite"');
  });

  test("rejects stale active guidance but allows clearly separated legacy evidence", () => {
    const example = "Neither → the default local SQLite path";
    const start = "## Current client contract\n";
    expect(currentClientFailures(agents.replace(start, `${start}${example}\n`))).toContain(example);
    expect(currentClientFailures(agents.replace("## Legacy data and explicit adapters\n",
      `## Legacy data and explicit adapters\nHistorical selection: ${example}\n`))).toEqual([]);
    expect(() => currentClientFailures(agents.replace(start, "## Missing current contract\n"))).toThrow();
    expect(() => currentClientFailures(`${agents}\n${start}duplicate`)).toThrow();
    expect(() => section("## Empty\n\n## Next\nbody", "Empty")).toThrow();
    const examples = [...agents.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g)].map(match => match[1]!).join("\n");
    expect(examples).not.toMatch(/add_provider\([^\n]*(?:api_key|secret_key)=/);
    expect(examples).not.toMatch(/emails serve[^\n]*3900/);
  });

  test("keeps the exact historical plan while superseding its client-store target", () => {
    expect(currentPlanFailures(plan)).toEqual([]);
    const historical = preservedHistory(plan);
    // This is the entire 362-line pre-reconciliation record, not a selected excerpt.
    expect(createHash("sha256").update(historical).digest("hex")).toBe(
      historicalDigest,
    );
    expect(historical).toContain("6646cc8");
    expect(historical).toContain("assertUniformCaseCoverage");
    expect(historical).toContain("Do NOT delete existing mail");
    expect(historical).toContain("Any future ratchet needs at least one structural");
    expect(historical).toContain("bun run build && bun run no-cloud:pack");
    expect(historical.match(/^\| (?:[1-9]|10) \|/gm)?.length).toBe(10);
  });

  test("fails closed on missing history, deleted gates and unmarked old targets", () => {
    const { historical } = planParts(plan);
    expect(() => planParts(plan.replace(historyStart, ""))).toThrow();
    expect(() => planParts(`${plan}\n${historyStart}`)).toThrow();
    expect(() => planParts(`${plan}\n${historyEnd}`)).toThrow();
    expect(() => planParts(plan.replace(historical, ""))).toThrow();
    const removedGate = historical.replace("bun run build && bun run no-cloud:pack", "omitted");
    expect(() => preservedHistory(plan.replace(historical, removedGate))).toThrow("Historical program evidence changed");
    const oldTarget = "exactly TWO client stores, forever";
    expect(currentPlanFailures(`${oldTarget}\n${plan}`)).toContain(oldTarget);
    expect(currentPlanFailures(`${plan}\n${oldTarget}`)).toContain(oldTarget);
  });

  test("documents real seam consumers and explicit compatibility without changing the contract", () => {
    for (const relative of ["src/store/email-store.ts", "src/storage.ts"]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toMatch(/No product code consumes this yet|NOTHING IN THE APP CONSUMES THIS|SECOND AND LAST/);
      expect(source).toContain("configured HTTP client");
      expect(source).toContain("explicit SQLite");
    }
    const messages = readFileSync(join(root, "src", "db", "emails.ts"), "utf8");
    expect(messages).toContain("if (handle === undefined) return createConfiguredEmailStore()");
    expect(messages).toContain("createSqliteEmailStore({ database: handle as Database");
    const seam = readFileSync(join(root, "src", "store", "email-store.ts"), "utf8");
    expect(seam).toContain("export interface EmailStore");
    expect(seam).toContain("readonly sendIntents: SendIntentsRepository;");
  });
});
