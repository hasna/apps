// hasna:allow-secret-file - secret-DETECTION fixture: asserts the scanner fires on synthetic credential-shaped markers. Synthetic only, verified at exact hunks.
import { describe, expect, test } from "bun:test";
import { BRAND_DOMAIN_LABELS, RULES, scanText, scanTextDetailed } from "./check-packed-artifact.js";

// Fixtures are assembled at runtime so this test file does not itself contain
// the literals the guard exists to keep out of the repository.
const BRAND = BRAND_DOMAIN_LABELS[0];
const apex = (tld: string) => `${BRAND}.${tld}`;
const host = (sub: string, tld: string) => `${sub}.${BRAND}.${tld}`;

function ids(text: string): string[] {
  return [...new Set(scanText(text).map((v) => v.ruleId))].sort();
}

describe("disclosure rules", () => {
  test("catches an owned apex domain literal — the 0.1.0 incident", () => {
    const built = `var DEFAULT_ALLOWED_EMAIL_DOMAINS = ["${apex("xyz")}", "${apex("dev")}"];`;
    const found = scanText(built, "dist/index.js");
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.every((v) => v.file === "dist/index.js")).toBe(true);
    expect(ids(built)).toContain("brand-domain");
  });

  test("catches multi-label apexes and hostnames beneath them", () => {
    expect(ids(`from "https://${host("domains", "xyz")}/v1"`)).toContain("brand-subdomain");
    expect(ids(`"${apex("co.uk")}"`)).toContain("brand-domain");
    expect(scanText(`"${host("tenants", "xyz")}"`).length).toBeGreaterThan(0);
  });

  test("reports the exact line so it can be fixed", () => {
    const found = scanText(`line one\nline two\nconst h = "${apex("app")}";`);
    expect(found[0]?.line).toBe(3);
    expect(found[0]?.excerpt).toBe(apex("app"));
  });

  test("catches private infrastructure hosts and addresses", () => {
    expect(ids("https://db.prod.internal:5432")).toContain("internal-host");
    expect(ids("host: 10.1.2.3")).toContain("private-ip");
    expect(ids("host: 192.168.0.7")).toContain("private-ip");
    expect(ids("host: 100.101.102.103")).toContain("private-ip"); // tailnet CGNAT
    expect(ids("https://box.example.ts.net")).toContain("tailnet-host");
    expect(ids("mydb.c9x.eu-west-1.rds.amazonaws.com")).toContain("aws-resource-endpoint");
    expect(ids("arn:aws:ses:us-east-1:123456789012:identity/x")).toContain("aws-account-id");
    expect(ids("123456789012.dkr.ecr.us-east-1.amazonaws.com/app")).toContain("aws-account-id");
  });
});

describe("credential rules", () => {
  test("catches standard credential shapes", () => {
    expect(ids(`AWS_ACCESS_KEY_ID=AKIA${"A1B2C3D4E5F6G7H8"}`)).toContain("aws-access-key-id");
    expect(ids(`token=ghp` + `_${"a".repeat(36)}`)).toContain("github-token");
    expect(ids(`//registry.npmjs.org/:_authToken=npm_${"b".repeat(36)}`)).toContain("npm-token");
    expect(ids(`xoxb-${"1".repeat(12)}-abcdef`)).toContain("slack-token");
    expect(ids(`key = "sk-${"c".repeat(32)}"`)).toContain("provider-api-key");
    // Fragment split so the stored text carries no contiguous
    // scanner-matching shape; the runtime value is still the full header.
    expect(ids("-----BEGIN OPENSSH " + "PRIVATE KEY-----")).toContain("private-key-block");
    expect(ids(`const password = "hunter2-hunter2";`)).toContain("hardcoded-secret");
    expect(ids(`eyJhbGciOiJI.eyJzdWIiOiIx.dBjftJeZ4CV`)).toContain("jwt");
  });

  test("credential matches are redacted, disclosure matches are not", () => {
    const secret = `AKIA${"A1B2C3D4E5F6G7H8"}`;
    const found = scanText(`AWS_ACCESS_KEY_ID=${secret}`);
    const hit = found.find((v) => v.ruleId === "aws-access-key-id")!;
    expect(hit.severity).toBe("credential");
    expect(hit.excerpt).not.toContain(secret);
    expect(hit.excerpt).toContain("<redacted>");

    const disclosed = scanText(`"${apex("xyz")}"`)[0]!;
    expect(disclosed.severity).toBe("disclosure");
    expect(disclosed.excerpt).toBe(apex("xyz"));
  });
});

describe("no false positives on legitimate build output", () => {
  test("scoped package names, env var names and public hosts pass", () => {
    const clean = [
      `import { mintApiKey } from "@${BRAND}/contracts/auth";`,
      `export const ALLOWED_EMAIL_DOMAINS_ENV = "HASNA_TENANTS_ALLOWED_EMAIL_DOMAINS";`,
      `const url = "https://github.com/${BRAND}/tenants";`,
      `const npmDocs = "https://www.npmjs.com/package/@${BRAND}/identities";`,
      `const bundle = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";`,
      `const ecs = "http://169.254.170.2" + relativeUri;`,
      `const dev = "http://localhost:3000";`,
      `const loop = "http://127.0.0.1:5432";`,
      `if (config.internal) return;`,
      `const host = \`email.\${region}.amazonaws.com\`;`,
      `headers["x-amz-security-token"] = creds.sessionToken;`,
      `const signingSecret = options.signingSecret;`,
    ].join("\n");
    expect(scanText(clean)).toEqual([]);
  });
});

describe("rule table", () => {
  test("every rule is global (all occurrences reported, not just the first)", () => {
    for (const rule of RULES) expect(rule.pattern.flags).toContain("g");
  });

  test("rule ids are unique", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  test("repeated scans are stable (no leaked regex lastIndex state)", () => {
    const text = `"${apex("xyz")}" and "${apex("dev")}"`;
    expect(scanText(text).length).toBe(scanText(text).length);
    expect(scanText(text).filter((v) => v.ruleId === "brand-domain").length).toBe(2);
  });
});

// ── integration: the code paths where two proven bypasses lived ──────────────
// scanText coverage alone missed both. These drive scanPackedArtifact over a
// real temp package with a real `npm pack --dry-run`.

import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPackedArtifact } from "./check-packed-artifact.js";

let pkgDir: string;

function writePackage(files: Record<string, string | Buffer>): void {
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({
    name: "artifact-guard-fixture", version: "0.0.0", files: ["dist"],
  }, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(pkgDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content as never);
  }
}

beforeEach(() => { pkgDir = mkdtempSync(join(tmpdir(), "artifact-guard-")); });
afterEach(() => { rmSync(pkgDir, { recursive: true, force: true }); });

describe("scanPackedArtifact (integration)", () => {
  test("a clean packed set reports no violations", () => {
    writePackage({ "dist/index.js": 'export const base = "https://auth.example.com";\n' });
    const report = scanPackedArtifact(pkgDir);
    expect(report.violations).toEqual([]);
    expect(report.binary).toEqual([]);
    expect(report.scanned).toContain("dist/index.js");
  });

  test("a leak in a packed file is found", () => {
    writePackage({ "dist/index.js": `export const d = ["${apex("xyz")}"];\n` });
    expect(scanPackedArtifact(pkgDir).violations.map((v) => v.ruleId)).toContain("brand-domain");
  });

  // REGRESSION: a single NUL byte used to make the guard SKIP the file and still
  // report "✓ clean" while the domain shipped inside the tarball.
  test("a NUL byte cannot hide a domain — scanned anyway AND flagged unscannable", () => {
    writePackage({
      "dist/index.js": "export const ok = 1;\n",
      "dist/blob.js": Buffer.concat([Buffer.from([0]), Buffer.from(`const d = "${apex("xyz")}";`)]),
    });
    const report = scanPackedArtifact(pkgDir);
    expect(report.scanned).toContain("dist/blob.js");
    expect(report.binary).toContain("dist/blob.js");
    expect(report.violations.some((v) => v.file === "dist/blob.js" && v.ruleId === "brand-domain")).toBe(true);
  });

  test("a UTF-16 encoded domain inside a binary file is found", () => {
    writePackage({
      "dist/index.js": "export const ok = 1;\n",
      "dist/wide.js": Buffer.concat([Buffer.from([0, 0]), Buffer.from(apex("xyz"), "utf16le")]),
    });
    expect(scanPackedArtifact(pkgDir).violations.some((v) => v.encoding === "utf16le")).toBe(true);
  });

  test("no build output is an error, never a clean report", () => {
    writePackage({});
    expect(() => scanPackedArtifact(pkgDir)).toThrow(/no built/);
  });

  test("a minified single-line bundle is still scanned", () => {
    writePackage({ "dist/index.js": `var a=1,b="${apex("xyz")}",c=3;`.repeat(20) });
    const report = scanPackedArtifact(pkgDir);
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.violations[0]!.line).toBe(1);
  });
});

describe("ignore annotations", () => {
  test("an annotated line is suppressed and recorded with its reason", () => {
    const text = `const a = "${apex("xyz")}"; // artifact-check-ignore: doc fixture`;
    const { violations, ignored } = scanTextDetailed(text, "dist/x.js");
    expect(violations).toEqual([]);
    expect(ignored).toEqual([{ file: "dist/x.js", line: 1, reason: "doc fixture" }]);
  });

  test("a bare marker with no reason does not suppress", () => {
    expect(scanTextDetailed(`const a = "${apex("xyz")}"; // artifact-check-ignore:`).violations.length)
      .toBeGreaterThan(0);
  });

  test("the annotation only affects its own line", () => {
    const text = `const a = "${apex("xyz")}"; // artifact-check-ignore: ok\nconst b = "${apex("dev")}";`;
    const { violations } = scanTextDetailed(text);
    expect(violations.length).toBe(1);
    expect(violations[0]!.line).toBe(2);
  });
});

describe("filename-shaped matches are not domains", () => {
  test("<brand>.contract.json does not trip the guard", () => {
    // The config-file convention of this package's own direct dependency.
    expect(scanText(`see ${BRAND}.contract.json for details`)).toEqual([]);
    expect(scanText(`import x from "./${BRAND}.config.yaml";`)).toEqual([]);
  });

  test("but real domains still do", () => {
    for (const tld of ["md", "co.uk", "xyz"]) {
      expect(scanText(`"${apex(tld)}"`).length).toBeGreaterThan(0);
    }
  });
});

// ── rules and classes added for the catalog / identities disclosures ────────

import {
  ALLOWED_LITERALS,
  ORG_ASSET_CLASSES,
  ORG_ASSET_THRESHOLD,
  findOrgAssetInventories,
} from "./check-packed-artifact.js";

function inventoryIds(text: string, file = "dist/index.js"): string[] {
  return findOrgAssetInventories(scanTextDetailed(text, file).sightings).map((f) => f.classId).sort();
}

describe("dotted namespaces are not domains", () => {
  // 60+ of these fired on the first run of this guard against this package.
  // A guard that is wrong 60 times is a guard someone deletes.
  test("schema ids under the brand label do not trip the domain rule", () => {
    expect(scanText(`const id = "${BRAND}.identities.agent";`)).toEqual([]);
    expect(scanText(`"${BRAND}.identities.configs/v1"`)).toEqual([]);
    expect(scanText(`schema: "${BRAND}.app.v1"`)).toEqual([]);
    expect(scanText(`"${BRAND}.identity"`)).toEqual([]);
  });

  test("but a real TLD still reports", () => {
    for (const tld of ["com", "xyz", "dev", "io"]) {
      expect(ids(`"${apex(tld)}"`)).toContain("brand-domain");
    }
  });
});

describe("internal API urls", () => {
  test("endpoints on private infrastructure are reported", () => {
    expect(ids(`fetch("https://${host("api", "xyz")}/v1/records")`)).toContain("internal-api-url");
    expect(ids(`const u = "https://vault.prod.internal:8200/";`)).toContain("internal-api-url");
    expect(ids(`const u = "http://box.tailnet.ts.net:9000/health";`)).toContain("internal-api-url");
    expect(ids(`const u = "http://10.4.5.6:5432";`)).toContain("internal-api-url-ip");
  });

  test("public and loopback endpoints are not", () => {
    const clean = [
      `const a = "https://api.github.com/repos";`,
      `const b = "http://localhost:3579/api";`,
      `const c = "http://127.0.0.1:8080/";`,
      `const d = "https://registry.npmjs.org/";`,
    ].join("\n");
    expect(scanText(clean)).toEqual([]);
  });
});

describe("snapshot provenance", () => {
  test("a resolved source label in packed data is reported", () => {
    expect(ids(`{"seededFrom":"opensource-scan","appId":"x"}`)).toContain("snapshot-provenance");
    expect(ids(`{ "exportedFrom": "workspace-crawl" }`)).toContain("snapshot-provenance");
    expect(ids(`harvestedBy: "nightly-inventory"`)).toContain("snapshot-provenance");
  });

  test("runtime provenance stamping is not a snapshot", () => {
    // The scanner that PRODUCES records legitimately names the key; it binds a
    // variable, so the value is not baked into the artifact.
    expect(scanText(`seededFrom: options.source,`)).toEqual([]);
    expect(scanText(`metadata.seededFrom = report.origin;`)).toEqual([]);
  });

  test("a bare timestamp is not a provenance disclosure", () => {
    // `…At` was deliberately dropped from the rule: every record schema has a
    // timestamp, and documenting an export's shape is not a leak.
    expect(scanText(`"exportedAt": "2026-07-01T00:00:00.000Z"`)).toEqual([]);
    expect(scanText(`"seededAt": "2026-07-06T11:22:13.133Z"`)).toEqual([]);
  });
});

describe("org-asset inventories", () => {
  test("one or two references stay silent", () => {
    expect(inventoryIds(`see open-alpha and open-beta for context`)).toEqual([]);
    expect(inventoryIds(`contact ada@${BRAND}.xyz or grace@${BRAND}.xyz`)).toEqual([]);
  });

  test("three distinct identifiers of one class is an inventory", () => {
    expect(inventoryIds(`open-alpha open-beta open-gamma`)).toContain("repo-folder");
    expect(inventoryIds(`a@${BRAND}.xyz b@${BRAND}.xyz c@${BRAND}.xyz`)).toContain("mailbox");
    expect(inventoryIds(`iapp-one iapp-two platform-example`)).toContain("internal-app");
    expect(inventoryIds(`box-a.ts.net box-b.ts.net 10.1.2.3`)).toContain("machine-name");
  });

  test("the same identifier repeated is still one identifier", () => {
    expect(inventoryIds("open-alpha ".repeat(50))).toEqual([]);
  });

  test("public npm package names are not an org-asset class", () => {
    // A name on a public registry discloses nothing; a checkout folder does.
    expect(inventoryIds(`@${BRAND}/alpha @${BRAND}/beta @${BRAND}/gamma @${BRAND}/delta`))
      .toEqual([]);
  });

  test("an annotated line contributes nothing to the counts", () => {
    const text = `open-alpha open-beta open-gamma // artifact-check-ignore: doc list`;
    expect(inventoryIds(text)).toEqual([]);
  });

  test("the threshold and classes are wired to the reported findings", () => {
    expect(ORG_ASSET_THRESHOLD).toBe(3);
    expect(new Set(ORG_ASSET_CLASSES.map((c) => c.id)).size).toBe(ORG_ASSET_CLASSES.length);
    for (const assetClass of ORG_ASSET_CLASSES) {
      for (const pattern of assetClass.patterns) expect(pattern.flags).toContain("g");
    }
  });
});

describe("allowed literals", () => {
  // The list is EMPTY in this package. These tests describe the mechanism so the
  // first entry someone adds arrives with a file and a reason attached.
  test("the allowance list starts empty — nothing here needs one", () => {
    expect(ALLOWED_LITERALS).toEqual([]);
  });

  test("every allowance must carry a file and a real reason", () => {
    for (const entry of ALLOWED_LITERALS) {
      expect(entry.file.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});

// ── rules and classes added for the catalog / identities disclosures ────────



describe("dotted namespaces are not domains", () => {
  // 60+ of these fired on the first run of this guard against this package.
  // A guard that is wrong 60 times is a guard someone deletes.
  test("schema ids under the brand label do not trip the domain rule", () => {
    expect(scanText(`const id = "${BRAND}.identities.agent";`)).toEqual([]);
    expect(scanText(`"${BRAND}.identities.configs/v1"`)).toEqual([]);
    expect(scanText(`schema: "${BRAND}.app.v1"`)).toEqual([]);
    expect(scanText(`"${BRAND}.identity"`)).toEqual([]);
  });

  test("but a real TLD still reports", () => {
    for (const tld of ["com", "xyz", "dev", "io"]) {
      expect(ids(`"${apex(tld)}"`)).toContain("brand-domain");
    }
  });
});

describe("internal API urls", () => {
  test("endpoints on private infrastructure are reported", () => {
    expect(ids(`fetch("https://${host("api", "xyz")}/v1/records")`)).toContain("internal-api-url");
    expect(ids(`const u = "https://vault.prod.internal:8200/";`)).toContain("internal-api-url");
    expect(ids(`const u = "http://box.tailnet.ts.net:9000/health";`)).toContain("internal-api-url");
    expect(ids(`const u = "http://10.4.5.6:5432";`)).toContain("internal-api-url-ip");
  });

  test("public and loopback endpoints are not", () => {
    const clean = [
      `const a = "https://api.github.com/repos";`,
      `const b = "http://localhost:3579/api";`,
      `const c = "http://127.0.0.1:8080/";`,
      `const d = "https://registry.npmjs.org/";`,
    ].join("\n");
    expect(scanText(clean)).toEqual([]);
  });
});

describe("snapshot provenance", () => {
  test("a resolved source label in packed data is reported", () => {
    expect(ids(`{"seededFrom":"opensource-scan","appId":"x"}`)).toContain("snapshot-provenance");
    expect(ids(`{ "exportedFrom": "workspace-crawl" }`)).toContain("snapshot-provenance");
    expect(ids(`harvestedBy: "nightly-inventory"`)).toContain("snapshot-provenance");
  });

  test("runtime provenance stamping is not a snapshot", () => {
    // The scanner that PRODUCES records legitimately names the key; it binds a
    // variable, so the value is not baked into the artifact.
    expect(scanText(`seededFrom: options.source,`)).toEqual([]);
    expect(scanText(`metadata.seededFrom = report.origin;`)).toEqual([]);
  });

  test("a bare timestamp is not a provenance disclosure", () => {
    // `…At` was deliberately dropped from the rule: every record schema has a
    // timestamp, and documenting an export's shape is not a leak.
    expect(scanText(`"exportedAt": "2026-07-01T00:00:00.000Z"`)).toEqual([]);
    expect(scanText(`"seededAt": "2026-07-06T11:22:13.133Z"`)).toEqual([]);
  });
});

describe("org-asset inventories", () => {
  test("one or two references stay silent", () => {
    expect(inventoryIds(`see open-alpha and open-beta for context`)).toEqual([]);
    expect(inventoryIds(`contact ada@${BRAND}.xyz or grace@${BRAND}.xyz`)).toEqual([]);
  });

  test("three distinct identifiers of one class is an inventory", () => {
    expect(inventoryIds(`open-alpha open-beta open-gamma`)).toContain("repo-folder");
    expect(inventoryIds(`a@${BRAND}.xyz b@${BRAND}.xyz c@${BRAND}.xyz`)).toContain("mailbox");
    expect(inventoryIds(`iapp-one iapp-two platform-example`)).toContain("internal-app");
    expect(inventoryIds(`box-a.ts.net box-b.ts.net 10.1.2.3`)).toContain("machine-name");
  });

  test("the same identifier repeated is still one identifier", () => {
    expect(inventoryIds("open-alpha ".repeat(50))).toEqual([]);
  });

  test("public npm package names are not an org-asset class", () => {
    // A name on a public registry discloses nothing; a checkout folder does.
    expect(inventoryIds(`@${BRAND}/alpha @${BRAND}/beta @${BRAND}/gamma @${BRAND}/delta`))
      .toEqual([]);
  });

  test("an annotated line contributes nothing to the counts", () => {
    const text = `open-alpha open-beta open-gamma // artifact-check-ignore: doc list`;
    expect(inventoryIds(text)).toEqual([]);
  });

  test("the threshold and classes are wired to the reported findings", () => {
    expect(ORG_ASSET_THRESHOLD).toBe(3);
    expect(new Set(ORG_ASSET_CLASSES.map((c) => c.id)).size).toBe(ORG_ASSET_CLASSES.length);
    for (const assetClass of ORG_ASSET_CLASSES) {
      for (const pattern of assetClass.patterns) expect(pattern.flags).toContain("g");
    }
  });
});


// ── regressions found by adversarial review ─────────────────────────────────
// Each of these was a working bypass. None had a test before.

import { spawnSync } from "node:child_process";
import { scanTarball } from "./check-packed-artifact.js";

describe("the TLD gate must not be deny-by-default", () => {
  // The first version allowlisted TLDs. Run against the 176 owned apexes from
  // the tenants incident, it caught 31 and silently ignored 145 — `.zone`,
  // `.ventures`, `.capital`, `.software`, … A missing entry has to cost a false
  // POSITIVE, which is loud and fixable, never a silent miss.
  test("an owned apex on an unusual TLD is still reported", () => {
    for (const tld of ["zone", "ventures", "capital", "foundation", "academy", "software", "solutions", "money", "legal", "tv", "cc", "pro", "social", "news", "global", "one"]) {
      expect(ids(`"${apex(tld)}"`)).toContain("brand-domain");
    }
  });

  test("dotted schema namespaces are still exempt", () => {
    for (const segment of ["identities", "agent", "configs", "contract", "runtime", "machine"]) {
      expect(scanText(`"${BRAND}.${segment}"`)).toEqual([]);
    }
  });
});

describe("the ignore annotation cannot be carried by data", () => {
  // A bare substring marker let one line of JSON suppress 10 mailboxes, 4 hosts,
  // 5 app ids and an internal URL while the run printed "clean". catalog ships
  // JSONL, one record per line, so this was reachable without malice.
  test("a marker inside a JSON string value does not suppress", () => {
    const laundered = `{"note":"artifact-check-ignore: reviewed","mailbox":"ceo@${BRAND}.xyz"}`;
    const { violations, ignored } = scanTextDetailed(laundered, "fixtures/x.json");
    expect(violations.length).toBeGreaterThan(0);
    expect(ignored).toEqual([]);
  });

  test("a marker in real comment syntax still suppresses", () => {
    for (const line of [
      `const a = "${apex("xyz")}"; // artifact-check-ignore: reviewed`,
      `const b = "${apex("xyz")}"; /* artifact-check-ignore: reviewed */`,
      `host = "${apex("xyz")}"  # artifact-check-ignore: reviewed`,
      `See \`${apex("xyz")}\`. <!-- artifact-check-ignore: reviewed -->`,
    ]) {
      expect(scanTextDetailed(line).violations).toEqual([]);
      expect(scanTextDetailed(line).ignored.length).toBe(1);
    }
  });

  test("the recorded reason stops at the comment terminator", () => {
    const { ignored } = scanTextDetailed(`x = "${apex("xyz")}" <!-- artifact-check-ignore: because -->`);
    expect(ignored[0]!.reason).toBe("because");
  });

  // REGRESSION: requiring comment syntax was not enough. A record ending
  // `"note":"… # artifact-check-ignore: …"}` has a comment token AND reaches end
  // of line, because the lazy reason capture swallows the closing `"}`. Five such
  // lines carried the entire 0.1.0 disclosure past a run that printed "clean".
  test("a JSONL record whose trailing string value ends in a marker suppresses nothing", () => {
    const laundered =
      `{"appId":"open-alpha","mailbox":"ada@${BRAND}.xyz",` +
      `"api":"https://${host("api", "xyz")}/v1/apps",` +
      `"note":"see runbook # artifact-check-ignore: internal notes field"}`;
    const { violations, ignored, sightings } = scanTextDetailed(laundered, "fixtures/apps.seed.jsonl");
    expect(violations.length).toBeGreaterThan(0);
    expect(sightings.length).toBeGreaterThan(0);
    expect(ignored).toEqual([]);
  });

  test("a marker is never honoured in a file format that has no comments", () => {
    // Unquoted, so only the extension rules this out — .json/.jsonl/.csv cannot
    // carry a comment, so a marker there is a data value whatever it looks like.
    const line = `${apex("xyz")}, # artifact-check-ignore: whole record`;
    for (const file of ["fixtures/apps.seed.jsonl", "fixtures/apps.json", "data/apps.csv"]) {
      const { violations, ignored } = scanTextDetailed(line, file);
      expect(violations.length).toBeGreaterThan(0);
      expect(ignored).toEqual([]);
    }
  });

  test("a marker inside a string literal in a code file is not honoured", () => {
    // The extension gate does not apply here; the quoted-region check does.
    const line = `const note = "${apex("xyz")} — see runbook # artifact-check-ignore: reviewed";`;
    const { violations, ignored } = scanTextDetailed(line, "dist/index.js");
    expect(violations.length).toBeGreaterThan(0);
    expect(ignored).toEqual([]);
  });

  test("a real comment after a quoted span is still honoured", () => {
    // The conservatism must not swallow the ordinary case: a closed string, or a
    // markdown backtick span containing quotes, leaves the marker outside.
    const code = `const a = "${apex("xyz")}"; // artifact-check-ignore: reviewed`;
    expect(scanTextDetailed(code, "dist/index.js").violations).toEqual([]);
    expect(scanTextDetailed(code, "dist/index.js").ignored.length).toBe(1);

    const doc = `Example: \`{"host":"${apex("xyz")}"}\` <!-- artifact-check-ignore: doc sample -->`;
    expect(scanTextDetailed(doc, "README.md").violations).toEqual([]);
    expect(scanTextDetailed(doc, "README.md").ignored.length).toBe(1);
  });
});

describe("packed file PATHS are scanned", () => {
  // The 0.4.4 leak was a 630-file tree whose directory names were agent slugs.
  // A variant with the data only in filenames would have been invisible.
  test("a mailbox in a path is reported", () => {
    writePackage({ "dist/index.js": "export const ok = 1;\n" });
    const report = scanPackedArtifact(pkgDir);
    expect(report.violations).toEqual([]);

    writePackage({
      "dist/index.js": "export const ok = 1;\n",
      [`dist/agents/ceo@${BRAND}.xyz/BIO.md`]: "nothing sensitive in the body\n",
    });
    const withPath = scanPackedArtifact(pkgDir);
    expect(withPath.violations.some((v) => v.file.endsWith("(path)"))).toBe(true);
  });
});

describe("an allowed literal is never silent", () => {
  // The header promises every use is printed. The class-sighting path used to
  // `continue` without recording, so a mailbox could be suppressed invisibly.
  test("suppressing an org-asset sighting still records an ignore", () => {
    const entry = ALLOWED_LITERALS[0];
    if (!entry) return; // catalog ships an empty list
    const { ignored } = scanTextDetailed(`"author": "<${entry.literal}>"`, entry.file);
    expect(ignored.length).toBeGreaterThan(0);
  });
});

describe("the tarball itself is verifiable", () => {
  // `scanPackedArtifact` certifies a file LIST; a file landing between that and
  // npm's own glob ships uncertified (106 certified, 107 shipped). `postpack`
  // scans the produced .tgz, which is the artifact rather than a prediction.
  test("scanTarball reads a real .tgz and finds what is inside it", () => {
    writePackage({ "dist/index.js": `export const d = "${apex("xyz")}";\n` });
    const packed = spawnSync("bun", ["pm", "pack", "--ignore-scripts", "--quiet"], { cwd: pkgDir, encoding: "utf8" });
    expect(packed.status).toBe(0);
    const name = (packed.stdout ?? "").trim().split("\n").pop()!;
    const report = scanTarball(join(pkgDir, name));
    expect(report.scanned).toContain("dist/index.js");
    expect(report.violations.map((v) => v.ruleId)).toContain("brand-domain");
  });

  test("scanTarball certifies a non-empty tarball even without built JavaScript", () => {
    // Measured at origin/main: the "no built `dist`" fail-closed rule lives
    // in the pre-pack scan (scanPackedArtifact, asserted at line 175);
    // scanTarball certifies whatever the tarball actually contains — a
    // tarball with files but no build output is scanned, not refused.
    writePackage({ "README.md": "no build output in this package\n" });
    const packed = spawnSync("bun", ["pm", "pack", "--ignore-scripts", "--quiet"], { cwd: pkgDir, encoding: "utf8" });
    expect(packed.status).toBe(0);
    const name = (packed.stdout ?? "").trim().split("\n").pop()!;
    const report = scanTarball(join(pkgDir, name));
    expect(report.scanned).toContain("README.md");
  });
});

describe("the re-entrancy sentinel fails closed", () => {
  // Bypass (b): the sentinel was read from ambient env and exited 0, so
  // `GUARD_ACTIVE=1 npm publish` skipped the scan entirely. Reverting that
  // `exit(2)` to `exit(0)` used to leave the whole suite green.
  test("an ambient sentinel exits 2, not 0", () => {
    const guard = join(import.meta.dir, "check-packed-artifact.ts");
    const result = spawnSync("bun", [guard], {
      cwd: join(import.meta.dir, ".."),
      encoding: "utf8",
      env: { ...process.env, CATALOG_PACK_GUARD_ACTIVE: "1" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("re-entered itself");
  });
});

describe("credential shapes added after review", () => {
  test("connection strings with embedded passwords are caught and redacted", () => {
    for (const dsn of [
      "postgres://admin:hunter2secret@db.example.com:5432/app",
      "mongodb+srv://svc:s3cr3tvalue@cluster.example.net/db",
      "redis://default:tokenvaluehere@cache.example.org:6379",
    ]) {
      const found = scanText(`const url = "${dsn}";`);
      expect(found.map((v) => v.ruleId)).toContain("connection-string-credential");
      expect(found.find((v) => v.ruleId === "connection-string-credential")!.excerpt).toContain("<redacted>");
    }
  });

  test("a DSN with no password is not a credential", () => {
    expect(scanText(`const url = "redis://cache.example.org:6379";`)).toEqual([]);
    expect(scanText(`const url = "https://api.github.com/repos";`)).toEqual([]);
  });

  test("literal Authorization headers are caught", () => {
    expect(ids(`Authorization: "Bearer abcdefghijklmnop"`)).toContain("authorization-header");
    expect(ids(`authorization = "Basic dXNlcjpwYXNzd29yZA=="`)).toContain("authorization-header");
  });

  test("provenance keys in snake and kebab case are caught", () => {
    expect(ids(`"seeded_from": "opensource-scan"`)).toContain("snapshot-provenance");
    expect(ids(`"derived-from": "workspace-crawl"`)).toContain("snapshot-provenance");
    expect(ids(`"collectedFrom": "nightly-inventory"`)).toContain("snapshot-provenance");
  });
});

describe("the fixture that shipped in 0.1.0", () => {
  // The exact shape of the leaked record, reassembled here rather than pasted,
  // so this test file is not itself a copy of the thing being kept out.
  function record(appId: string, npmScope: string): string {
    return JSON.stringify({
      schema: "hasna.app.v1",
      id: `app_${appId.replace(/-/g, "_")}`,
      metadata: { version: "0.1.0", seededFrom: "opensource-scan", seededAt: "2026-07-06T11:22:13.133Z" },
      appId,
      npmName: `${npmScope}/${appId.replace(/^open-/, "")}`,
      repoFolder: appId,
      githubUrl: `https://github.com/${BRAND}/${appId.replace(/^open-/, "")}.git`,
      lifecycle: "active",
    });
  }

  test("a single record is caught by its provenance marker", () => {
    expect(ids(record("open-alpha", `@${BRAND}xyz`))).toContain("snapshot-provenance");
  });

  test("a multi-record inventory is caught by the aggregate classes too", () => {
    const jsonl = [
      record("open-alpha", `@${BRAND}xyz`),
      record("open-beta", `@${BRAND}`),
      record("open-gamma", `@${BRAND}`),
    ].join("\n");
    const found = findOrgAssetInventories(scanTextDetailed(jsonl, "fixtures/apps.seed.jsonl").sightings);
    expect(found.map((f) => f.classId).sort()).toEqual(["repo-folder"]);
    expect(found[0]!.identifiers).toEqual(["open-alpha", "open-beta", "open-gamma"]);
  });

  test("the synthetic replacement fixture is clean", () => {
    const synthetic = JSON.stringify({
      schema: "hasna.app.v1",
      id: "app_example_widget",
      appId: "example-widget",
      npmName: "@example/widget",
      repoFolder: "example-widget",
      githubUrl: "https://github.com/example/widget.git",
      lifecycle: "active",
    });
    expect(scanText(synthetic, "fixtures/apps.seed.jsonl")).toEqual([]);
    expect(findOrgAssetInventories(scanTextDetailed(synthetic).sightings)).toEqual([]);
  });
});

// ── the packed-file list ─────────────────────────────────────────────────────
// `npm pack --dry-run --json` is the primary source of the file list this guard
// certifies. On CI runners where npm exits 0 but writes nothing to stdout the
// guard used to throw "produced no JSON" and abort the release, so it now falls
// back to `bun pm pack --dry-run`. The fallback is only worth having if it
// returns the same list NPM would, which is what these tests pin — so the
// expected value comes from real npm.
//
// It must not come from a second run of `bun pm pack`: a packager that disagrees
// with npm would then sit on BOTH sides of the equality and stay green while an
// uncertified file shipped. That is the divergence class this guard exists for
// ("106 files certified, 107 shipped, the extra one full of mailboxes").

import { listPackedFiles, npmPackEnv } from "./check-packed-artifact.js";

/** The packed paths REAL npm reports, sorted — the fallback's expected answer. */
function npmPackedPaths(cwd: string): string[] {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: npmPackEnv(),
  });
  expect(result.status).toBe(0);
  const stdout = (result.stdout ?? "").trim();
  const start = stdout.indexOf("[");
  // An npm that printed nothing here would leave no independent expectation to
  // compare against, so it is a test failure, never a quiet second bun run.
  expect(start).toBeGreaterThanOrEqual(0);
  const parsed = JSON.parse(stdout.slice(start)) as Array<{ files?: Array<{ path: string }> }>;
  const paths = (parsed[0]?.files ?? []).map((file) => file.path).sort();
  expect(paths.length).toBeGreaterThan(0);
  return paths;
}

/** Puts a stub `npm` first on PATH for the duration of `run`. */
function withStubNpm<T>(script: string, run: () => T): T {
  const binDir = mkdtempSync(join(tmpdir(), "stub-npm-"));
  writeFileSync(join(binDir, "npm"), script, { mode: 0o755 });
  const realPath = process.env["PATH"];
  process.env["PATH"] = `${binDir}:${realPath ?? ""}`;
  try {
    return run();
  } finally {
    process.env["PATH"] = realPath;
    rmSync(binDir, { recursive: true, force: true });
  }
}

describe("listPackedFiles survives an npm that prints no JSON", () => {
  test("the `bun pm pack --dry-run` fallback certifies exactly the list npm would", () => {
    writePackage({ "dist/index.js": "export const ok = 1;\n", "dist/nested/util.js": "export const u = 2;\n" });
    // Captured while real npm is still on PATH, before the stub shadows it.
    const expected = npmPackedPaths(pkgDir);
    const files = withStubNpm("#!/bin/sh\nexit 0\n", () => listPackedFiles(pkgDir));
    expect(files.map((file) => file.path).sort()).toEqual(expected);
    expect(files.every((file) => file.size > 0)).toBe(true);
  });

  test("an npm that fails outright still fails loudly rather than falling back", () => {
    writePackage({ "dist/index.js": "export const ok = 1;\n" });
    expect(() => withStubNpm("#!/bin/sh\necho boom >&2\nexit 1\n", () => listPackedFiles(pkgDir))).toThrow(/npm pack --dry-run/);
  });
});
