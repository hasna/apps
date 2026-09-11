import { describe, expect, it } from "bun:test";
import { ServiceContractManifestSchema } from "@hasna/contracts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import pkg from "../package.json" with { type: "json" };
import contract from "../hasna.contract.json" with { type: "json" };
import { resolveClientModeSelection } from "./lib/mode.js";
import { emailsSelfHostedOpenApi } from "./server/self-hosted/openapi.js";
import { SELF_HOSTED_APP, SELF_HOSTED_APP_ALIASES } from "./server/self-hosted/env.js";
import {
  CANONICAL_BINS,
  CANONICAL_PACKAGE,
  CANONICAL_REPOSITORY,
  packageIdentityFailures,
} from "../scripts/package-identity-lib.mjs";

const root = join(import.meta.dir, "..");

// Canonical published identity.
//
// @hasna/emails is the canonical package for this repository and owns the
// emails/emails-mcp/emails-serve bins. @hasna/mailery is an abandoned package
// line and must not be revived by publishing this tree under that name.
//
// These assertions pin the package identity independently of release-version
// history or the separate cloud CLI. The predicate itself lives in
// scripts/package-identity-lib.mjs and is the SAME code CI runs — the
// negative arm below proves it refuses a foreign repository url, so the gate
// is shown to fire rather than merely observed to stay green.
const IDENTITY_REFUSAL = `repository provenance must be ${CANONICAL_REPOSITORY}`;

function manifestWith(overrides: { url?: string | undefined; directory?: string | undefined }) {
  const manifest = structuredClone(pkg) as typeof pkg & {
    repository: { type: string; url?: string; directory?: string };
  };
  if ("url" in overrides) {
    if (overrides.url === undefined) delete manifest.repository.url;
    else manifest.repository.url = overrides.url;
  }
  if ("directory" in overrides) {
    if (overrides.directory === undefined) delete manifest.repository.directory;
    else manifest.repository.directory = overrides.directory;
  }
  return manifest;
}

describe("published package identity", () => {
  it("publishes as @hasna/emails from the apps/emails monorepo directory", () => {
    expect(pkg.name).toBe(CANONICAL_PACKAGE);
    expect(pkg.repository.url).toBe(CANONICAL_REPOSITORY);
    expect(pkg.repository.directory).toBe("apps/emails");
  });

  it("ships only the emails* bins and leaves mailery* free for the cloud CLI", () => {
    expect(Object.keys(pkg.bin)).toEqual(CANONICAL_BINS);
  });

  it("declares the same identity in the service contract", () => {
    expect(contract.name).toBe("emails");
    expect(contract.bins).toEqual(CANONICAL_BINS);
    expect(contract.metadata.migrateCommand).toEqual(["emails", "db", "migrate"]);
  });

  it("tracks a manifest accepted by the installed contracts schema", () => {
    // Emails builds with `--packages external` (the AWS and MCP SDKs stay external),
    // so the resolver is a RUNTIME import and must be a real dependency for the
    // published package and the global install. The manifest pins it exactly and the
    // kit version matches (secrets #1782 still applies to the emitted declarations,
    // which spell the crossing types locally rather than importing the package).
    expect(pkg.dependencies["@hasna/contracts"]).toBe(contract.kitVersion);
    const result = ServiceContractManifestSchema.safeParse(contract);
    if (!result.success) throw new Error(result.error.message);

    expect(contract.storage.backend).toBe("sqlite");
    expect(contract.storage.engines).toEqual(["sqlite", "postgresql"]);
    expect(contract.serviceSurfaces.every((surface) => !("deploymentModes" in surface))).toBe(true);
  });

  it("declares the readiness probe public when OpenAPI does", () => {
    const api = contract.serviceSurfaces.find((surface) => surface.kind === "api");
    expect(api?.readiness).toEqual({ method: "GET", path: "/ready", public: true });
    expect(emailsSelfHostedOpenApi.paths["/ready"]?.get?.security).toEqual([]);
  });

  it("asserts the canonical identity in CI through the one shared predicate", () => {
    const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    // CI must call the runner, not carry its own copy of the checks: an inline
    // copy is a second code path that can drift from this test, and it cannot
    // be exercised against a fixture.
    expect(ci).toContain("bun run scripts/verify-package-identity.mjs");
    expect(ci).not.toContain("pkg.repository?.url !== ");
    expect(ci).not.toContain("@hasna/mailery");
  });

  it("packs only paths the build actually produces", () => {
    // "dist" is produced by `bun run build`; every other packed path must exist
    // in the tree. `dashboard/dist` satisfied neither: no script or CI step ever
    // produced it and no code read it.
    //
    // "!"-prefixed entries are npm-packlist negation globs: they exclude built
    // test-support artifacts ("!dist/test-support/**",
    // "!dist/**/*test-support.d.ts") from paths the build produces, so they can
    // never exist as literal paths. Each must instead match at least one real
    // path under the built tree, or the exclusion is dead weight.
    for (const entry of pkg.files) {
      if (entry === "dist") continue;
      if (entry.startsWith("!")) {
        // The negation's target must exist under the built tree, otherwise the
        // exclusion never removes anything from the tarball.
        const matches = [...new Glob(entry.slice(1)).scanSync(root)];
        expect({ entry, exists: matches.length > 0 }).toEqual({ entry, exists: true });
        continue;
      }
      expect({ entry, exists: existsSync(join(root, entry)) }).toEqual({ entry, exists: true });
    }
  });
});

describe("repository provenance gate", () => {
  // NEGATIVE ARM. A gate that has never been shown to fire is indistinguishable
  // from no gate at all, so every foreign or dead repository shape below must be
  // refused by the same predicate CI runs.
  it("accepts the canonical identity in the live manifest", () => {
    expect(packageIdentityFailures(pkg)).toEqual([]);
  });

  it("refuses a foreign repository url", () => {
    const failures = packageIdentityFailures(manifestWith({ url: "https://github.com/hasna/emails.git" }));
    expect(failures).toContain(`${IDENTITY_REFUSAL} (got https://github.com/hasna/emails.git)`);
  });

  it("refuses every dead repository shape, including the un-normalized git+ form", () => {
    const dead: Array<string | undefined> = [
      "https://github.com/hasna/emails.git", // pre-monorepo per-app repo
      "git+https://github.com/hasna/emails.git", // ...in the npm git+ form
      "https://github.com/hasnaxyz/emails.git", // deleted org
      "https://github.com/hasna-products/emails.git", // dead name class
      "git+https://github.com/hasna/apps.git", // right repo, not byte-exact
      "https://github.com/hasna-internal/internal-apps.git", // the other home
      undefined, // absent repository.url
    ];
    for (const url of dead) {
      const failures = packageIdentityFailures(manifestWith({ url }));
      expect({ url, refused: failures.some((failure) => failure.startsWith(IDENTITY_REFUSAL)) }).toEqual({
        url,
        refused: true,
      });
    }
  });

  it("refuses a foreign repository directory", () => {
    for (const directory of ["apps/mailery", "sdk", undefined]) {
      const failures = packageIdentityFailures(manifestWith({ directory }));
      expect({
        directory,
        refused: failures.some((failure) => failure.startsWith("repository directory must be")),
      }).toEqual({ directory, refused: true });
    }
  });

  it("refuses the abandoned mailery package line", () => {
    const revived = structuredClone(pkg) as typeof pkg & { name: string };
    revived.name = "@hasna/mailery";
    expect(packageIdentityFailures(revived)).toContain("unexpected package name: @hasna/mailery");
  });
});

describe("api-key app slug", () => {
  it("mints under the canonical emails slug and still verifies mailery-era keys", () => {
    // The unreleased rename minted keys under "mailery". Those keep verifying as
    // an alias; new keys carry the canonical slug again.
    expect(SELF_HOSTED_APP).toBe("emails");
    expect([...SELF_HOSTED_APP_ALIASES]).toEqual(["mailery"]);
  });

  it("keeps the contract's api-key app aligned with the server", () => {
    expect(contract.metadata.apiKeyApp).toBe(SELF_HOSTED_APP);
    expect(contract.metadata.apiKeyAppAliases).toEqual([...SELF_HOSTED_APP_ALIASES]);
  });
});

describe("the retired deployment-mode environment surface", () => {
  it("has no startup env bridge", () => {
    expect(existsSync(join(root, "src/lib/env-compat.ts"))).toBe(false);
    expect(existsSync(join(root, "src/lib/env-compat.test.ts"))).toBe(false);
  });

  it("has deleted the mode-switch guard module with the mode axis", () => {
    // Deployment modes were removed (hasna/apps#1566) and the credential
    // resolver adoption (hasna/apps#1720) deleted the last guards that spelled
    // the removed variables. The guard module and the env bridge are both gone:
    // no EMAILS_MODE / HASNA_EMAILS_MODE variable selects anything, and nothing
    // in the tree is allowed to refuse or read it.
    expect(existsSync(join(root, "src/lib/retired-deployment-mode.ts"))).toBe(false);
    expect(existsSync(join(root, "src/lib/retired-deployment-mode.test.ts"))).toBe(false);
  });
});

describe("superseded and dead scaffolding", () => {
  it("keeps exactly one generated REST client", () => {
    // src/selfhost.ts is generated from the live OpenAPI doc by
    // scripts/generate-selfhost-sdk.ts and drift-checked in CI. sdk/ was a second,
    // hand-maintained client that nothing built, published, or regenerated — yet
    // root `bun test` collected its tests and reported it green.
    expect(existsSync(join(root, "src/selfhost.ts"))).toBe(true);
    expect(existsSync(join(root, "sdk"))).toBe(false);
  });

  it("has no unreferenced operator or build scripts", () => {
    expect(existsSync(join(root, "scripts/nightly_sync.sh"))).toBe(false);
    expect(existsSync(join(root, "scripts/docker-prune-file-deps.mjs"))).toBe(false);
  });

  it("has no duplicate storage-mode resolver", () => {
    // src/lib/mode.ts + src/server/self-hosted/env.ts are the live resolvers.
    expect(existsSync(join(root, "src/storage-kit/mode.ts"))).toBe(false);
  });
});
