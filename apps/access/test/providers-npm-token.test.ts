import { describe, expect, it } from "bun:test";
import {
  buildNpmTokenCreateCommandPreview,
  buildNpmTokenName,
  planNpmTokenProvision,
  validateNpmTokenRequestPayload,
  type NpmTokenRequestPayload,
} from "../src/providers/npm-token.js";
import { ValidationError } from "../src/types/index.js";

const NOW = new Date("2026-07-09T00:00:00.000Z");

const BASE_REQUEST: NpmTokenRequestPayload = {
  org: "hasna",
  scope: "@hasna",
  packageName: "access",
  principal: "agent:marcus",
  station: "spark01",
  purpose: "publish",
  permission: "read-write",
  expiry: "2026-08-08T00:00:00.000Z",
  revision: 3,
  secretRef: "hasna/npm/tokens/open-access-publish",
  bypass2fa: true,
};

function fakeRawSecret(...parts: string[]): string {
  return parts.join("");
}

describe("npm token provider naming", () => {
  it("builds deterministic names from org/scope/package/station/ci/use/permission/expiry/revision", () => {
    expect(
      buildNpmTokenName({
        org: "Hasna",
        scope: "@hasna",
        packageName: "@hasna/access",
        station: "spark01",
        ci: "none",
        use: "publish",
        permission: "read-write",
        expiry: "2026-08-08T00:00:00.000Z",
        revision: 3,
      }),
    ).toBe("npm-org-hasna-scope-hasna-pkg-hasna-access-station-spark01-ci-none-use-publish-perm-read-write-exp-20260808-rev-3");
  });
});

describe("npm token provider validation", () => {
  it("normalizes a valid package request without storing a token value", () => {
    const request = validateNpmTokenRequestPayload(BASE_REQUEST, { now: NOW });

    expect(request.org).toBe("hasna");
    expect(request.scope).toBe("@hasna");
    expect(request.packageName).toBe("@hasna/access");
    expect(request.expiresAt).toBe("2026-08-08T00:00:00.000Z");
    expect(request.expiresInDays).toBe(30);
    expect(request.secretRef).toBe(BASE_REQUEST.secretRef);
    expect(JSON.stringify(request)).not.toContain("tokenValue");
  });

  it("rejects invalid request payload fields", () => {
    expect(() =>
      validateNpmTokenRequestPayload({ ...BASE_REQUEST, packageName: undefined, scope: undefined }, { now: NOW }),
    ).toThrow(ValidationError);
    expect(() =>
      validateNpmTokenRequestPayload({ ...BASE_REQUEST, permission: "admin" as NpmTokenRequestPayload["permission"] }, { now: NOW }),
    ).toThrow(ValidationError);
    expect(() => validateNpmTokenRequestPayload({ ...BASE_REQUEST, expiry: "2026-07-01T00:00:00.000Z" }, { now: NOW })).toThrow(
      ValidationError,
    );
    expect(() => validateNpmTokenRequestPayload({ ...BASE_REQUEST, ci: "github-actions" }, { now: NOW })).toThrow(ValidationError);
    expect(() => validateNpmTokenRequestPayload({ ...BASE_REQUEST, station: undefined }, { now: NOW })).toThrow(ValidationError);
    expect(() => validateNpmTokenRequestPayload({ ...BASE_REQUEST, secretRef: "plainref" }, { now: NOW })).toThrow(ValidationError);
    expect(() => validateNpmTokenRequestPayload({ ...BASE_REQUEST, expiry: "2026-08-09T00:00:00.000Z" }, { now: NOW })).toThrow(
      ValidationError,
    );
    expect(() =>
      validateNpmTokenRequestPayload({ ...BASE_REQUEST, packageName: undefined, permission: "read-write" }, { now: NOW }),
    ).toThrow(ValidationError);
    expect(() => validateNpmTokenRequestPayload({ ...BASE_REQUEST, secretRef: fakeRawSecret("npm", "_", "rawtokensecret") }, { now: NOW })).toThrow(
      ValidationError,
    );
  });
});

describe("npm token provider command preview", () => {
  it("builds a safe package token create preview with bypass-2fa when requested", () => {
    const preview = buildNpmTokenCreateCommandPreview(BASE_REQUEST, { now: NOW });

    expect(preview.command).toBe("npm");
    expect(preview.args).toContain("--name");
    expect(preview.args).toContain("npm-org-hasna-scope-hasna-pkg-hasna-access-station-spark01-ci-none-use-publish-perm-read-write-exp-20260808-rev-3");
    expect(preview.args).toContain("--token-description");
    expect(preview.args).toContain("--expires");
    expect(preview.args).toContain("30");
    expect(preview.args).toContain("--packages");
    expect(preview.args).toContain("@hasna/access");
    expect(preview.args).toContain("--packages-and-scopes-permission");
    expect(preview.args).toContain("read-write");
    expect(preview.args).toContain("--bypass-2fa");
    expect(preview.target).toEqual({ scopes: [], packages: ["@hasna/access"] });
    expect(preview.safeToLog).toBe(true);
    expect(preview.shell).not.toContain(BASE_REQUEST.secretRef);
  });

  it("builds a scope token create preview and omits bypass-2fa unless requested", () => {
    const preview = buildNpmTokenCreateCommandPreview(
      {
        org: "hasna",
        scope: "@hasna",
        principal: "agent:marcus",
        ci: "github-actions",
        purpose: "install",
        permission: "read-only",
        expiry: "2026-07-24T00:00:00.000Z",
        revision: 1,
        secretRef: "hasna/npm/tokens/install-scope",
      },
      { now: NOW },
    );

    expect(preview.args).toContain("--scopes");
    expect(preview.args).toContain("@hasna");
    expect(preview.args).not.toContain("--packages");
    expect(preview.args).not.toContain("--bypass-2fa");
    expect(preview.target).toEqual({ scopes: ["@hasna"], packages: [] });
  });

  it("keeps the open-secrets handoff to secretRef plus metadata only", () => {
    const preview = buildNpmTokenCreateCommandPreview(BASE_REQUEST, { now: NOW });

    expect(preview.secretsHandoff.system).toBe("@hasna/secrets");
    expect(preview.secretsHandoff.secretRef).toBe(BASE_REQUEST.secretRef);
    expect(preview.secretsHandoff.accessStores).toBe("secretRef-and-metadata-only");
    expect(preview.secretsHandoff.operatorCommand.args).toEqual(["set", BASE_REQUEST.secretRef]);
    expect(preview.secretsHandoff.operatorCommand.shell).toBe("secrets set hasna/npm/tokens/open-access-publish");
    expect(preview.secretsHandoff.metadata).toEqual(preview.metadata);
    expect(preview.secretsHandoff.tokenValueHandling).toBe("operator-or-secured-process");
    expect(preview.secretsHandoff).not.toHaveProperty("tokenValue");
  });

  it("is preview-only by default and requires an approved bounded request for execute mode", () => {
    const preview = planNpmTokenProvision(BASE_REQUEST, { now: NOW });
    expect(preview.mode).toBe("preview");
    expect(preview.execute).toBe(false);
    expect(preview.preview.secretsHandoff).not.toHaveProperty("tokenValue");

    expect(() => planNpmTokenProvision(BASE_REQUEST, { now: NOW, execute: true })).toThrow(ValidationError);
    expect(() =>
      planNpmTokenProvision(BASE_REQUEST, {
        now: NOW,
        execute: true,
        approvedRequest: {
          provider: "npm",
          resource_kind: "token",
          resource_ref: "npm:@hasna/other",
          status: "approved",
          secret_ref: BASE_REQUEST.secretRef,
        },
      }),
    ).toThrow(ValidationError);

    const approved = planNpmTokenProvision(BASE_REQUEST, {
      now: NOW,
      execute: true,
      approvedRequest: {
        id: "req_123",
        provider: "npm",
        resource_kind: "token",
        resource_ref: "npm:@hasna/access",
        status: "approved",
        secret_ref: BASE_REQUEST.secretRef,
      },
    });
    expect(approved.mode).toBe("approved-manual");
    expect(approved.approvedRequestId).toBe("req_123");
    expect(approved.preview.safeToLog).toBe(true);
    expect(approved.preview.secretsHandoff).not.toHaveProperty("tokenValue");
  });
});
