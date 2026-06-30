import { expect, test } from "bun:test";
import { parseEvidenceInput, renderEvidenceSanitizerReport, sanitizeEvidenceInput } from "../src/evidence-sanitizer.js";

test("evidence sanitizer preserves safe count-only redacted evidence", () => {
  const report = sanitizeEvidenceInput({
    version: "0.1.61",
    allServicesZero: true,
    desiredTotal: 0,
    edgeUrl: "[redacted-edge-url]",
    directOriginUrl: "[redacted-direct-origin-url]",
    registry: "https://registry.npmjs.org/@hasna/uptime",
    release: "https://github.com/hasna/uptime/releases/tag/v0.1.61",
    integrity: "sha512-aH/zZxZbMMtBj8f7wRr6zdzUmvgS2Oc0WobDg4+r1G2bb43Zhth7h6YlkyMLuuknd0SJpHOxDb/glpQtcrEqpw==",
    managedPolicy: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    tfvarsExample: "infra/aws/terraform.tfvars.example",
    envName: "HASNA_UPTIME_EDGE_READ_TOKEN",
  }, { now: () => new Date("2026-06-30T00:00:00.000Z"), source: "unit-test" });

  expect(report.unsafe).toBe(false);
  expect(report.status).toBe("safe");
  expect(report.summary.findings).toBe(0);
  expect(report.redacted).toBe(true);
  expect(report.checkedAt).toBe("2026-06-30T00:00:00.000Z");
});

test("evidence sanitizer redacts nested cloud, recipient, path, and secret-shaped values", () => {
  const rawValues = [
    "123456789012",
    "https://d123456789abc.cloudfront.net",
    "http://internal-origin.us-east-1.elb.amazonaws.com",
    "http://169.254.169.254/latest/meta-data",
    "subnet-1234abcd",
    "wks_2tyysw05cwap",
    "/tmp/open-uptime-prod.tfplan",
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "raw-token-value",
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "api_key=supersecret",
    "postgres://user:password@db.example.invalid/uptime",
    "/home/hasna/private/evidence.json",
    "ops@example.com",
    "+15555550123",
    "ghp_abcdefghijklmnopqrstuvwxyz",
    "arn:aws:s3:::open-uptime-private-evidence/prod/status.json",
    "s3://open-uptime-private-evidence/prod/status.json",
    "secret_access_key: supersecret",
    "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
  ];
  const report = sanitizeEvidenceInput({
    account: rawValues[0],
    nested: {
      edge: rawValues[1],
      origin: rawValues[2],
      privateUrl: rawValues[3],
      resource: rawValues[4],
      workspaceId: rawValues[5],
      planPath: rawValues[6],
      digest: rawValues[7],
      token: rawValues[8],
      error: `Authorization: ${rawValues[9]}`,
      query: rawValues[10],
      database: rawValues[11],
      path: rawValues[12],
      email: rawValues[13],
      phone: rawValues[14],
      [rawValues[15]]: "dynamic secret key",
      s3Arn: rawValues[16],
      s3Uri: rawValues[17],
      assignmentLine: rawValues[18],
      privateKeyPem: rawValues[19],
    },
  }, { source: "/tmp/raw-private-evidence.json" });

  const serialized = JSON.stringify(report);
  expect(report.unsafe).toBe(true);
  expect(report.status).toBe("unsafe");
  expect(report.summary.findings).toBeGreaterThanOrEqual(15);
  for (const raw of rawValues) {
    expect(serialized).not.toContain(raw);
  }
  expect(serialized).not.toContain("/tmp/raw-private-evidence.json");
  expect(report.findings.map((finding) => finding.kind)).toContain("object-key");
  expect(report.findings.map((finding) => finding.kind)).toContain("sensitive-field-value");
  expect(JSON.stringify(report.sanitized)).toContain("secret_access_key: redacted");
  expect(renderEvidenceSanitizerReport(report)).toContain("blocked shared-evidence values");
});

test("evidence sanitizer redacts AWS origin-header values in config-shaped evidence", () => {
  const cloudfrontHeader = "cf-origin-secret-abcdefghijklmnopqrstuvwxyz0123456789";
  const albHeader = "alb-origin-secret-abcdefghijklmnopqrstuvwxyz0123456789";
  const report = sanitizeEvidenceInput({
    DistributionConfig: {
      Origins: {
        Items: [
          {
            CustomHeaders: {
              Items: [
                {
                  HeaderName: "X-Open-Uptime-Origin-Verify",
                  HeaderValue: cloudfrontHeader,
                },
              ],
            },
          },
        ],
      },
    },
    Rules: [
      {
        Conditions: [
          {
            Field: "http-header",
            HttpHeaderConfig: {
              HttpHeaderName: "X-Open-Uptime-Origin-Verify",
              Values: [albHeader],
            },
          },
        ],
      },
    ],
  });

  const serialized = JSON.stringify(report);
  expect(report.unsafe).toBe(true);
  expect(serialized).not.toContain(cloudfrontHeader);
  expect(serialized).not.toContain(albHeader);
  expect(report.findings.map((finding) => finding.kind)).toContain("sensitive-field-value");
});

test("evidence sanitizer parses input formats without echoing invalid JSON", () => {
  expect(parseEvidenceInput("{\"ok\":true}", "auto")).toEqual({ value: { ok: true }, format: "json" });
  expect(parseEvidenceInput("plain evidence text", "auto")).toEqual({ value: "plain evidence text", format: "text" });
  expect(parseEvidenceInput("plain evidence text", "text")).toEqual({ value: "plain evidence text", format: "text" });
  expect(() => parseEvidenceInput("raw-token-value", "json")).toThrow("not valid JSON");
  expect(() => parseEvidenceInput("  ")).toThrow("empty");
});
