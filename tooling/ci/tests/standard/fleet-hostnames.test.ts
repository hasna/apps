/**
 * fleet-hostnames — standard-adherence suite, fleet-alignment gate.
 *
 * Ruling (c): the ONLY client authority is the fleet gateway,
 * `https://api.hasna.com/<app>`. No member may carry:
 *
 *   - `*.hasna.xyz` (or bare `hasna.xyz`) — the internal origin domain — in
 *     its source, manifest, docs, Dockerfile or task environment; the
 *     gateway fronts every origin and the origins refuse direct traffic;
 *   - `hasna.internal` — the private service mesh name;
 *   - a loopback client default (`http://localhost:<port>` or
 *     `http://127.0.0.1:<port>` as a client base URL): a client that falls
 *     back to a local server when no credential resolves is the "silent
 *     local fallback" the fail-closed ruling (d) forbids. A SERVER binding a
 *     loopback listener is legitimate and is not matched (paths under
 *     `server/`, `serve/`, `daemon/`, `worker/`, `runner/`, `migrate/`).
 *
 * Test material and CHANGELOGs are skipped by shape (see fleet-scan.ts);
 * everything else a member must be allowed to spell is an ALLOWLIST entry
 * with a reason. Comment lines are reported with `(comment)` so owners rank
 * live code first, but they are still violations: the rulings forbid the
 * vocabulary in the public tree, not only the behaviour.
 *
 * Also scanned: `tooling/fleet/hosted-apps.json` `baseUrl` values (the
 * registry pin that keeps a member on its origin host) and the root
 * `deploy-*.yml` lanes (task environment).
 *
 * MODE: report-only at landing (GATE_MODES in gate-mode.ts). Owners: the
 * per-app fail-closed PRs of the alignment wave (W6 for todos, mementos,
 * projects, hooks, loops; the member's own lane otherwise). Flip to hard
 * when this report prints 0 violations on main.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR, REPO_ROOT } from "./census";
import { assertGate } from "./gate-mode";
import { grepFile, isCommentLine, memberDirsIn, memberScanFiles, type LineHit } from "./fleet-scan";

export const GATE = "fleet-hostnames";

export const PATTERNS: Array<{ name: string; re: RegExp; codeOnly?: boolean; clientOnly?: boolean }> = [
  { name: "hasna-xyz-origin", re: /(?:^|[^A-Za-z0-9_\\])hasna\.xyz\b|\.hasna\.xyz\b/i },
  { name: "hasna-internal-host", re: /\bhasna\.internal\b/i },
  // A URL literal on a loopback host with a FIXED port (or no port) in client
  // code — the shape of a hard-coded client default. A dynamic port
  // (`http://127.0.0.1:${port}`) addresses a process the tool itself just
  // started (OAuth callback, health probe) and is not a fallback authority.
  // Comments are skipped (they explain the anti-pattern) and server-side
  // paths are skipped (a listener binds loopback by design).
  { name: "loopback-client-default", re: /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+|(?!:))/i, codeOnly: true, clientOnly: true },
];

const SERVER_PATH = /(?:^|\/)(?:server|serve|daemon|worker|runner|migrate|api)(?:\/|-entry|\.ts$|\.js$)/;

/**
 * Deliberate tolerances, each with a reason. Keep this list SHORT and
 * specific: a member's path plus the pattern it may match. A stale entry
 * (member/path no longer matches) fails the hygiene test below.
 */
export const ALLOWLIST: Array<{ member: string; path: RegExp; pattern: string; reason: string }> = [
  // Third-party LOCAL LLM runtimes (Ollama, LM Studio) listen on loopback by
  // their own convention; these presets address a vendor process, not a
  // Hasna fleet store, and there is no hosted authority to fail closed to.
  { member: "switcher", path: /^src\/presets\.ts$/, pattern: "loopback-client-default", reason: "Ollama / LM Studio provider presets (third-party local runtimes)." },
  { member: "tai", path: /^src\/(?:ai-sdk-models\.ts|providers\/router\.ts)$/, pattern: "loopback-client-default", reason: "TAI_LOCAL_BASE_URL default for a local Ollama-compatible provider (third-party local runtime)." },
];

export interface HostnameViolation {
  member: string;
  pattern: string;
  hit: LineHit;
}

export function fleetHostnameViolations(appsDir: string = APPS_DIR): HostnameViolation[] {
  const out: HostnameViolation[] = [];
  for (const { name, dir } of memberDirsIn(appsDir)) {
    for (const file of memberScanFiles(dir)) {
      for (const p of PATTERNS) {
        if (p.clientOnly && file.scope === "src" && SERVER_PATH.test(file.relative)) continue;
        if (p.clientOnly && file.scope !== "src") continue;
        for (const hit of grepFile(file, p.re)) {
          if (p.codeOnly && hit.comment) continue;
          if (ALLOWLIST.some((a) => a.member === name && a.pattern === p.name && a.path.test(hit.relative))) continue;
          out.push({ member: name, pattern: p.name, hit });
        }
      }
    }
  }
  return out;
}

/** Registry pins: a hosted-apps entry whose baseUrl is an origin host. */
export function registryOriginPins(registryPath: string = path.join(REPO_ROOT, "tooling", "fleet", "hosted-apps.json")): string[] {
  let doc: { apps?: Array<{ app?: string; source?: string; baseUrl?: string }> };
  try {
    doc = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch {
    return [];
  }
  return (doc.apps ?? [])
    .filter((e) => e.source === "monorepo" && typeof e.baseUrl === "string" && /hasna\.xyz/i.test(e.baseUrl))
    .map((e) => `registry: tooling/fleet/hosted-apps.json: ${e.app} baseUrl pins an origin host (${e.baseUrl})`);
}

/** Root deploy lanes: task environment strings. */
export function deployLaneViolations(workflowsDir: string = path.join(REPO_ROOT, ".github", "workflows")): string[] {
  const out: string[] = [];
  if (!fs.existsSync(workflowsDir)) return out;
  for (const name of fs.readdirSync(workflowsDir)) {
    if (!/^deploy-.*\.ya?ml$/.test(name)) continue;
    const lines = fs.readFileSync(path.join(workflowsDir, name), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const p of PATTERNS.slice(0, 2)) {
        if (p.re.test(line)) out.push(`deploy-lane: .github/workflows/${name}:${i + 1}: ${p.name}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  return out;
}

export function formatViolation(v: HostnameViolation): string {
  return `${v.member}: ${v.hit.relative}:${v.hit.line}: ${v.pattern}${v.hit.comment ? " (comment)" : ""}: ${v.hit.text}`;
}

describe("standard-adherence: fleet hostnames (ruling c)", () => {
  test("no member carries *.hasna.xyz, hasna.internal, or a loopback client default; registry and deploy lanes pin no origin host", () => {
    const violations = [
      ...fleetHostnameViolations().map(formatViolation),
      ...registryOriginPins(),
      ...deployLaneViolations(),
    ];
    const perMember = new Map<string, number>();
    for (const v of violations) perMember.set(v.split(":")[0]!, (perMember.get(v.split(":")[0]!) ?? 0) + 1);
    console.info(`[${GATE}] census: ${violations.length} hit(s) across ${perMember.size} member(s): ${[...perMember.entries()].map(([m, n]) => `${m}=${n}`).join(" ")}`);
    assertGate(GATE, violations, "replace the origin host with https://api.hasna.com/<app> and delete loopback client defaults (fail closed instead)");
  }, 120_000);

  test("allowlist hygiene: every entry still matches something (no rot)", () => {
    const stale = ALLOWLIST.filter((a) => {
      const dir = path.join(APPS_DIR, a.member);
      if (!fs.existsSync(dir)) return true;
      const p = PATTERNS.find((x) => x.name === a.pattern);
      if (!p) return true;
      return !memberScanFiles(dir).some((f) => a.path.test(f.relative) && grepFile(f, p.re).length > 0);
    });
    expect(stale.map((a) => `${a.member} ${a.path} ${a.pattern}`), "stale ALLOWLIST entries — delete them").toEqual([]);
  });

  test("self-test: fires on a planted origin host, mesh name and loopback client default; stays silent on the gateway, on a server listener and on test material", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hostnames-self-test-"));
    try {
      const apps = path.join(root, "apps");
      const bad = path.join(apps, "bad");
      fs.mkdirSync(path.join(bad, "src", "lib"), { recursive: true });
      fs.writeFileSync(path.join(bad, "package.json"), JSON.stringify({ name: "@hasna/bad" }));
      fs.writeFileSync(
        path.join(bad, "src", "lib", "client.ts"),
        'export const BASE = process.env.BAD_API_URL ?? "https://bad.hasna.xyz";\nconst local = env.URL || "http://localhost:19427";\nconst probe = `http://127.0.0.1:${port}/health`; // dynamic port: a process we started, not a default\n',
      );
      fs.writeFileSync(path.join(bad, "Dockerfile"), "FROM oven/bun\nENV BAD_MESH=bad.hasna.internal\n");
      fs.writeFileSync(path.join(bad, "hasna.contract.json"), JSON.stringify({ description: "served at https://bad.hasna.xyz" }));

      const good = path.join(apps, "good");
      fs.mkdirSync(path.join(good, "src", "server"), { recursive: true });
      fs.mkdirSync(path.join(good, "src", "testing"), { recursive: true });
      fs.writeFileSync(path.join(good, "package.json"), JSON.stringify({ name: "@hasna/good" }));
      fs.writeFileSync(path.join(good, "src", "client.ts"), 'export const BASE = "https://api.hasna.com/good";\n// the old code defaulted to http://localhost:3000 — never again\n');
      fs.writeFileSync(path.join(good, "src", "server", "index.ts"), 'Bun.serve({ hostname: "127.0.0.1", port: 0 }); const self = "http://127.0.0.1:0";\n');
      fs.writeFileSync(path.join(good, "src", "testing", "fixture.ts"), 'export const origin = "https://good.hasna.xyz";\n');
      fs.writeFileSync(path.join(good, "src", "client.test.ts"), 'const u = "http://localhost:1";\n');
      fs.writeFileSync(path.join(good, "CHANGELOG.md"), "- removed the good.hasna.xyz default\n");

      const v = fleetHostnameViolations(apps);
      const badPatterns = new Set(v.filter((x) => x.member === "bad").map((x) => x.pattern));
      expect(badPatterns).toEqual(new Set(["hasna-xyz-origin", "hasna-internal-host", "loopback-client-default"]));
      expect(v.filter((x) => x.member === "bad" && x.hit.relative === "hasna.contract.json")).toHaveLength(1);
      expect(v.filter((x) => x.member === "bad" && x.pattern === "loopback-client-default")).toHaveLength(1);
      expect(v.filter((x) => x.member === "good").map(formatViolation)).toEqual([]);

      // Registry pin arm.
      const registry = path.join(root, "hosted-apps.json");
      fs.writeFileSync(registry, JSON.stringify({ apps: [{ app: "bad", source: "monorepo", baseUrl: "https://bad.hasna.xyz" }, { app: "good", source: "monorepo" }] }));
      expect(registryOriginPins(registry)).toHaveLength(1);

      // Deploy-lane arm.
      const wf = path.join(root, "workflows");
      fs.mkdirSync(wf);
      fs.writeFileSync(path.join(wf, "deploy-bad.yml"), "env:\n  ORIGIN: https://bad.hasna.xyz\n  # comment mentioning bad.hasna.xyz is fine\n");
      fs.writeFileSync(path.join(wf, "ci.yml"), "env:\n  X: https://x.hasna.xyz\n");
      expect(deployLaneViolations(wf)).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
