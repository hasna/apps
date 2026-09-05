/**
 * catalog-runnable.test.ts — the OSS catalog ships instruction prose AND runnable
 * executable skills, and every executable one must run with no credential.
 *
 * ## History, and what this file now guards
 *
 * This file began life as the successor to the hosted-metadata packaging guards:
 * when the hosted set was emptied, the catalog was briefly curated down to
 * instruction-only prose, and this file asserted "zero executable skills". That
 * curation has been reversed. The 66 archived executable skills that require NO
 * credential (verified: no `process.env.<KEY>` read, no documented key, no
 * provider SDK) are restored alongside the 20 instruction skills, so the catalog
 * is 86 skills: 20 instruction + 66 executable.
 *
 * The executable half reintroduces a real risk, and the invariants here exist to
 * pin it down:
 *
 *   1. A `bin` pointing into a `src/` that `npm pack` stripped installs cleanly
 *      and then cannot run — a silent break. Guarded by "every executable skill
 *      ships a runnable entry point" over both the repo tree and the packed
 *      tarball.
 *   2. A restored executable skill that reads a provider credential turns the OSS
 *      catalog back into a BYO-key catalog. The whole point of the restore was to
 *      ship ONLY credential-free skills, so this is the load-bearing guard:
 *      `no shipped executable skill requires a credential`, with a positive
 *      control fixture so it can never pass vacuously.
 *   3. The package must still ship no credential VALUE. The one legitimate
 *      secret-SHAPED string in the catalog is the security-audit scanner's PEM
 *      "PRIVATE KEY" detection regex; it is allowlisted exactly on that file,
 *      mirroring scripts/release-guard.ts.
 *
 * The hosted/premium set stays empty — no skill declares an off-repo runtime.
 */

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPackedFiles } from "./packlist.js";
import { listHostedMetadataSlugs, parseHostedSourceExclusionSlugs } from "./hosted-skill-set.js";
import { parseSkillFrontmatter } from "./skill-validation.js";
import { loadRegistry } from "./registry.js";
import { isServerOwnedSkill, resolveRunRouting } from "./run-routing.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const REPO_ROOT = process.cwd();
const SKILLS_ROOT = join(REPO_ROOT, "skills");

const skillDirs = readdirSync(SKILLS_ROOT).filter(
  (entry) =>
    entry !== "_common" && !entry.startsWith(".") && statSync(join(SKILLS_ROOT, entry)).isDirectory(),
);

function skillKind(slug: string): "instruction" | "executable" {
  const skillMd = join(SKILLS_ROOT, slug, "SKILL.md");
  if (!existsSync(skillMd)) return "executable";
  return parseSkillFrontmatter(readFileSync(skillMd, "utf8"))?.kind === "instruction"
    ? "instruction"
    : "executable";
}

const instructionSkills = skillDirs.filter((slug) => skillKind(slug) === "instruction");
const executableSkills = skillDirs.filter((slug) => skillKind(slug) === "executable");

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collectFiles(path));
    else out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Credential detection — the definition of "requires a credential".
//
// Mirrors the credential half of ENV_VAR_PATTERN/GENERIC_ENV_PATTERN in
// src/lib/skillinfo.ts. A var is a credential when its name ends in a secret/key
// suffix and NOT in an output/config suffix. `_ID`, `_URL`, `_REGION`, `_BUCKET`,
// `_ENDPOINT`, `_DIR`, `_PATH`, `_OUTPUT` are configuration, never credentials —
// so `AWS_ACCESS_KEY_ID` (config-shaped) does not disqualify while
// `AWS_SECRET_ACCESS_KEY` does.
// ---------------------------------------------------------------------------
const CREDENTIAL_SUFFIX = /_(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|CLIENT_SECRET)$/;
const CONFIG_SUFFIX = /_(?:URL|ID|ENDPOINT|REGION|BUCKET|DIR|PATH|OUTPUT)$/;
function isCredentialVar(name: string): boolean {
  return CREDENTIAL_SUFFIX.test(name) && !CONFIG_SUFFIX.test(name);
}

// Bare env-var tokens as they appear in prose/`.env.example`. Deliberately close
// to ENV_VAR_PATTERN in skillinfo.ts so a documented credential is caught.
const DOC_ENV_TOKEN =
  /\b([A-Z][A-Z0-9_]{2,}(?:_API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD|_URL|_ID|_ENDPOINT|_REGION|_BUCKET))\b/g;

/**
 * Credential env vars a skill REQUIRES to run, derived over its own directory two
 * ways:
 *   - src: a literal `process.env.<VAR>` / `process.env["<VAR>"]` read of a
 *     credential-named var — what makes a key mandatory at runtime.
 *   - docs: a credential-named token in SKILL.md / README.md / CLAUDE.md /
 *     `.env.example` — a key declared as required in prose.
 *
 * Keys accessed dynamically through a shared helper with a graceful fallback are
 * intentionally NOT counted: siteanalyze reads a provider key via
 * `skills/_common/vision.ts` only to ENHANCE its output and runs fully in "quick
 * mode" without one, so it requires no credential.
 */
function requiredCredentialVars(dir: string): string[] {
  const found = new Set<string>();
  for (const file of collectFiles(dir)) {
    const content = readFileSync(file, "utf8");
    if (file.endsWith(".ts") || file.endsWith(".js")) {
      for (const m of content.matchAll(
        /process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/g,
      )) {
        const name = m[1] ?? m[2];
        if (name && isCredentialVar(name)) found.add(name);
      }
    } else if (
      file.endsWith(".md") ||
      file.endsWith(".env.example") ||
      file.endsWith(".env.local.example")
    ) {
      for (const m of content.matchAll(DOC_ENV_TOKEN)) {
        if (isCredentialVar(m[1])) found.add(m[1]);
      }
    }
  }
  return [...found].sort();
}

describe("every catalog entry is runnable without a vendor service (R2)", () => {
  // Anti-vacuity for the whole file. Every assertion below iterates one of these
  // sets; an empty catalog would turn all of them green while proving nothing.
  test("the catalog is non-empty and every entry is classified", () => {
    // OSS catalog: 20 instruction-kind prose skills + 66 restored credential-free
    // executable skills = 86.
    expect(skillDirs.length).toBe(86);
    expect(instructionSkills.length).toBe(20);
    expect(executableSkills.length).toBe(66);
    expect(instructionSkills.length + executableSkills.length).toBe(skillDirs.length);
  });

  // The property the whole PR series exists to establish.
  test("no skill declares an off-repo runtime", () => {
    expect(listHostedMetadataSlugs(SKILLS_ROOT)).toEqual([]);
  });

  test("every executable skill ships a runnable entry point in the repo", () => {
    const broken = executableSkills.filter((slug) => {
      const dir = join(SKILLS_ROOT, slug);
      return !existsSync(join(dir, "src", "index.ts")) && !existsSync(join(dir, "src", "index.js"));
    });
    expect(broken).toEqual([]);
  });

  test("every instruction skill ships prose and no implementation", () => {
    const broken = instructionSkills.filter((slug) => {
      const dir = join(SKILLS_ROOT, slug);
      return !existsSync(join(dir, "SKILL.md")) || existsSync(join(dir, "src"));
    });
    expect(broken).toEqual([]);
  });
});

describe("the published package carries what the catalog promises (zero corpus)", () => {
  const packed = getPackedFiles(REPO_ROOT);
  const packedSet = new Set(packed);

  test("packs a non-trivial file list", () => {
    // migrations, docs, README, LICENSE, and package.json pack to well over 5
    // files even before a build. Floored well below the real count so it stays
    // anti-vacuous without pinning an exact number — and so an unbuilt local
    // `bun test` does not fail on this test before CI's build-then-test order.
    expect(packed.length).toBeGreaterThan(5);
  });

  // Inverts the retired "hosted src is excluded" guard. `files` is
  // ORDER-SENSITIVE and negations are easy to leave behind; a stale
  // `!skills/{...}/src` entry would silently strip the implementation of a skill
  // that now needs it, while `package.json` still advertises a `bin` into it.
  test("no skill source is excluded from the package", () => {
    const files: string[] = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).files;
    expect(parseHostedSourceExclusionSlugs(files)).toEqual([]);
    expect(files.filter((entry) => /^!skills\/.*\/src$/.test(entry))).toEqual([]);
  });

  // The zero-corpus boundary, per skill: the catalog lives in the tree, never in
  // the tarball. Every one of these assertions passes vacuously only if the whole
  // packlist is empty — which the non-trivial-file-list test above prevents.
  test("no executable skill's entry point ships in the package", () => {
    const shipped = executableSkills.filter(
      (slug) =>
        packedSet.has(`skills/${slug}/src/index.ts`) || packedSet.has(`skills/${slug}/src/index.js`),
    );
    expect(shipped).toEqual([]);
  });

  test("no instruction skill's SKILL.md ships in the package", () => {
    const shipped = instructionSkills.filter((slug) => packedSet.has(`skills/${slug}/SKILL.md`));
    expect(shipped).toEqual([]);
  });
});

describe("run routing resolves from configuration, credential, and the server-owned marker", () => {
  // Mock inputs only — never a real credential or origin. The resolver is pure:
  // the route decision depends on exactly these three inputs and nothing else.
  const MOCK_CREDENTIAL = "mock-api-key-for-routing-test";
  const MOCK_ORIGIN = "https://skills.example.com";
  const serverOwnedSkill = { name: "server-owned-demo", serverOwned: true };
  const localSkill = { name: "local-demo", serverOwned: false };

  test("a server-owned skill routes remote when an origin and a credential are present", () => {
    expect(resolveRunRouting(serverOwnedSkill, MOCK_CREDENTIAL, MOCK_ORIGIN)).toEqual({
      route: "remote",
      apiKey: MOCK_CREDENTIAL,
      apiOrigin: MOCK_ORIGIN,
    });
  });

  test("a server-owned skill fails closed without a credential — never a silent local run", () => {
    const routing = resolveRunRouting(serverOwnedSkill, null, MOCK_ORIGIN);
    expect(routing.route).toBe("error");
    if (routing.route !== "error") throw new Error("expected error routing");
    expect(routing.code).toBe("REMOTE_REQUIRES_CREDENTIAL");
    expect(routing.error).toContain("skills auth login");
  });

  test("a server-owned skill fails closed without a configured origin", () => {
    const routing = resolveRunRouting(serverOwnedSkill, MOCK_CREDENTIAL, undefined);
    expect(routing.route).toBe("error");
    if (routing.route !== "error") throw new Error("expected error routing");
    expect(routing.code).toBe("REMOTE_REQUIRES_ORIGIN");
    expect(routing.error).toContain("skills setup --api-url");
  });

  test("a local skill stays local even when an origin and a credential are configured", () => {
    expect(resolveRunRouting(localSkill, MOCK_CREDENTIAL, MOCK_ORIGIN)).toEqual({ route: "local" });
  });

  test("a local skill stays local when nothing is configured", () => {
    expect(resolveRunRouting(localSkill, null, undefined)).toEqual({ route: "local" });
  });

  test("every shipped catalog entry routes local by default (no credential, no origin)", () => {
    for (const skill of loadRegistry()) {
      expect(resolveRunRouting(skill, null, undefined)).toEqual({ route: "local" });
    }
  });

  test("the server-owned marker is the routing switch on a skill (positive control)", () => {
    expect(isServerOwnedSkill(serverOwnedSkill)).toBe(true);
    expect(isServerOwnedSkill(localSkill)).toBe(false);
    expect(isServerOwnedSkill({ serverOwned: undefined })).toBe(false);
  });
});

describe("no shipped executable skill requires a credential", () => {
  // The load-bearing invariant of the restore: the executable half of the catalog
  // is exactly the credential-free subset. Any skill that reads or documents a
  // provider key would have turned the OSS back into a BYO-key catalog.
  test("the executable catalog reads and documents no required credential", () => {
    const offenders: string[] = [];
    for (const slug of executableSkills) {
      const creds = requiredCredentialVars(join(SKILLS_ROOT, slug));
      if (creds.length) offenders.push(`${slug}: ${creds.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  // Positive control. Without this the assertion above could pass on a detector
  // that finds nothing. The detector MUST flag a key read in src, a key declared
  // in prose, and MUST NOT flag output/config vars.
  test("the credential detector flags a key-requiring skill (positive control)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cred-guard-"));
    try {
      const readsKey = join(tmp, "reads-key");
      mkdirSync(join(readsKey, "src"), { recursive: true });
      writeFileSync(join(readsKey, "src", "index.ts"), "const k = process.env.OPENAI_API_KEY;\n");
      expect(requiredCredentialVars(readsKey)).toContain("OPENAI_API_KEY");

      const documentsKey = join(tmp, "documents-key");
      mkdirSync(documentsKey, { recursive: true });
      writeFileSync(join(documentsKey, "SKILL.md"), "# k\n\nRequires `STRIPE_SECRET_KEY` to run.\n");
      expect(requiredCredentialVars(documentsKey)).toContain("STRIPE_SECRET_KEY");

      const configOnly = join(tmp, "config-only");
      mkdirSync(join(configOnly, "src"), { recursive: true });
      writeFileSync(
        join(configOnly, "src", "index.ts"),
        "const d = process.env.SKILLS_OUTPUT_DIR;\nconst u = process.env.API_BASE_URL;\n",
      );
      expect(requiredCredentialVars(configOnly)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // The other half of the rule: the OSS must ship no credential VALUE. Asserted
  // against the packed tarball, not the repo.
  test("the packed package ships no credential value", () => {
    const secretShaped = [
      /\bsk-[A-Za-z0-9]{24,}/,
      /\bghp[_][A-Za-z0-9]{30,}/,
      /\bAKIA[A-Z0-9]{16}\b/,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, // hasna:allow-secret
    ];
    // security-audit is a hardcoded-secret scanner: its detection table embeds
    // the PEM "PRIVATE KEY" header as a regex to FIND leaked keys, never as a
    // credential value. Allowlisted exactly on that file, mirroring the
    // scanAllowlist entry in scripts/release-guard.ts.
    const allowlist = new Set<string>(["skills/security-audit/src/index.ts"]);
    const leaks: string[] = [];
    for (const path of getPackedFiles(REPO_ROOT)) {
      if (path.startsWith("dist/") || path.startsWith("bin/")) continue;
      if (allowlist.has(path)) continue;
      const abs = join(REPO_ROOT, path);
      if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
      const content = readFileSync(abs, "utf8");
      for (const pattern of secretShaped) {
        if (pattern.test(content)) leaks.push(`${path}: ${pattern}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
