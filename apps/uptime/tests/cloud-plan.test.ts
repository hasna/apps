import { expect, test } from "bun:test";
import { buildAwsDeploymentPlan, buildPrivateProbeCloudConfig, renderPrivateProbeEnv } from "../src/cloud-plan.js";

test("buildAwsDeploymentPlan generates a dry-run AWS plan with generic package defaults", () => {
  const plan = buildAwsDeploymentPlan({
    image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/open-uptime:test",
    runtimePackageIntegrity: "sha512-exampleIntegrity==",
  });
  const serialized = JSON.stringify(plan);

  expect(plan.kind).toBe("open-uptime.aws-deployment-plan");
  expect(plan.version).toBe(4);
  expect(plan.accountName).toBe("aws-profile");
  expect(plan.region).toBe("us-east-1");
  expect(plan.resources.vpcId).toBe("vpc-xxxxxxxx");
  expect(plan.resources.efsFileSystem).toBe("open-uptime-prod-data");
  expect(plan.resources.efsAccessPoint).toBe("open-uptime-prod-uptime");
  expect(plan.resources.hostedSqliteDbPath).toBe("/data/uptime/uptime.db");
  expect(plan.resources.protectedAccessMode).toBe("cloudfront_default_domain");
  expect(plan.resources.edgeDistribution).toBe("open-uptime-prod-edge");
  expect(plan.resources.protectedAccessUrl).toBe("https://<cloudfront-domain>");
  expect(plan.resources.cloudfrontOrigin).toMatchObject({
    protocolPolicy: "http-only",
    domainName: "<alb-dns-name>",
    requiresMatchingCertificate: false,
    liveTrafficApproved: false,
  });
  expect(plan.resources.cloudfrontOrigin?.risk).toContain("Temporary HTTP-origin bridge");
  expect(plan.resources.originVerification).toMatchObject({
    mode: "cloudfront_origin_header",
    requiredBeforeScaleUp: true,
    headerName: "X-Open-Uptime-Origin-Verify",
    valueStoredInTerraformState: true,
  });
  expect(plan.resources.originVerification.stateAccessWarning).toContain("Terraform state");
  expect(plan.status).toBe("blocked");
  expect(plan.canApply).toBe(false);
  expect(plan.image.dockerfile).toBe("Dockerfile.package");
  expect(plan.image.expectedIntegrity).toBe("sha512-exampleIntegrity==");
  expect(plan.image.buildCommand).toContain("BLOCKED:");
  expect(plan.image.buildCommand).toContain("Dockerfile.package");
  expect(buildAwsDeploymentPlan().image.uri).toContain("@sha256:<image-digest>");
  expect(plan.resources.imageBuilder).toBe("open-uptime-prod-image-builder");
  expect(plan.image.pushCommands.join("\n")).toContain("BLOCKED:");
  expect(plan.image.pushCommands.join("\n")).toContain("@hasna/uptime@0.1.25");
  expect(plan.runbook.deploy.join("\n")).toContain("must verify npm dist.integrity sha512-exampleIntegrity==");
  expect(plan.requiredEvidence).toContain("Published package dist.integrity pinned in the private infra root or an explicit not-live exception.");
  expect(plan.image.pushCommands.join("\n")).not.toContain("aws codebuild start-build");
  expect(plan.runbook.deploy.join("\n")).toContain("do not run migration");
  expect(plan.runbook.deploy.join("\n")).toContain("CloudFront default HTTPS domain");
  expect(plan.runbook.deploy.join("\n")).toContain("origin verification header binding");
  expect(plan.runbook.deploy.join("\n")).toContain("switch the origin to https-only");
  expect(plan.runbook.deploy.join("\n")).not.toContain("Run the migration task");
  expect(plan.infra).toMatchObject({
    path: "infra/aws",
    applyAllowed: false,
  });
  expect(plan.resources.services.map((service) => service.role)).toEqual([
    "web",
    "scheduler",
    "public-probe",
    "reporter",
    "migration",
  ]);
  expect(plan.resources.services.every((service) => service.desiredCount === 0)).toBe(true);
  expect(plan.resources.services.find((service) => service.role === "web")?.targetDesiredCount).toBe(1);
  expect(plan.resources.services.filter((service) => service.role !== "web").every((service) => service.targetDesiredCount === 0)).toBe(true);
  expect(plan.resources.services.find((service) => service.role === "web")?.secrets.HASNA_UPTIME_HOSTED_TOKEN)
    .toBe("open-uptime/prod/hosted-token");
  expect(plan.resources.services.find((service) => service.role === "web")?.environment.HASNA_UPTIME_HOSTED_SQLITE_DB)
    .toBe("/data/uptime/uptime.db");
  expect(plan.resources.services.find((service) => service.role === "web")?.environment.HASNA_UPTIME_ALLOWED_ORIGINS)
    .toBe("https://<cloudfront-domain>");
  expect(plan.resources.services.filter((service) => service.role !== "web").every((service) => service.environment.HASNA_UPTIME_HOSTED_SQLITE_DB === undefined)).toBe(true);
  expect(plan.resources.services.find((service) => service.role === "web")?.secrets.HASNA_UPTIME_DATABASE_URL)
    .toBeUndefined();
  expect(plan.resources.services.find((service) => service.role === "public-probe")?.secrets.HASNA_UPTIME_DATABASE_URL)
    .toBeUndefined();
  expect(plan.resources.alarms).toEqual(["open-uptime-prod-web-5xx", "open-uptime-prod-web-unhealthy"]);
  expect(plan.safety).toMatchObject({
    liveAwsMutation: false,
    plaintextSecrets: false,
    hostedLocalSqliteAllowed: false,
  });
  expect(plan.requiredEvidence).toContain("EFS encryption, access point, mount-target, AWS Backup, and restore-drill evidence.");
  expect(plan.requiredEvidence).toContain("CloudFront-default-domain origin-header config, origin transport decision, direct-origin denial evidence, auth-denial smokes, and web alarm checks.");
  expect(plan.blockers.join("\n")).toContain("origin verification header binding");
  expect(plan.blockers.join("\n")).toContain("origin transport is still http-only");
  expect(plan.blockers.join("\n")).not.toContain("no reviewed Dockerfile");
  expect(plan.requiredEvidence.length).toBeGreaterThan(3);
  expect(serialized).not.toContain("AWS_SECRET_ACCESS_KEY");
  expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  expect(serialized).not.toContain("aws ecr create-repository");
  expect(serialized).not.toContain("aws s3api create-bucket");
  expect(serialized).not.toContain("aws ecs create-cluster");
  expect(serialized).not.toContain("aws ecs update-service");
  expect(serialized).not.toContain("aws codebuild start-build");
  expect(serialized).not.toContain("docker push ");
  expect(serialized).not.toContain("\"DATABASE_URL\"");
  expect(serialized).not.toContain("private-account-label");
  expect(serialized).not.toContain("private-workspace-id");
  expect(serialized).not.toContain("vpc-deadbeefdeadbeef0");
  expect(serialized).not.toContain("uptime.private.example");
  expect(serialized).not.toContain("private/org/path");
});

test("buildAwsDeploymentPlan can describe CloudFront HTTPS-origin mode", () => {
  const plan = buildAwsDeploymentPlan({
    cloudfrontOriginProtocolPolicy: "https-only",
    cloudfrontOriginDomainName: "uptime-origin.example.net",
  });

  expect(plan.resources.protectedAccessMode).toBe("cloudfront_default_domain");
  expect(plan.resources.cloudfrontOrigin).toMatchObject({
    protocolPolicy: "https-only",
    domainName: "uptime-origin.example.net",
    requiresMatchingCertificate: true,
    liveTrafficApproved: false,
  });
  expect(plan.resources.cloudfrontOrigin?.risk).toContain("match certificate_arn");
  expect(plan.blockers.join("\n")).not.toContain("origin transport is still http-only");
  expect(plan.blockers.join("\n")).not.toContain("needs cloudfront_origin_domain_name");
});

test("buildAwsDeploymentPlan can describe custom ALB TLS mode without default CloudFront edge", () => {
  const plan = buildAwsDeploymentPlan({
    protectedAccessMode: "alb_https_cert",
    hostname: "uptime.example.net",
    runtimePackageVersion: "0.1.8",
  });

  expect(plan.version).toBe(4);
  expect(plan.resources.protectedAccessMode).toBe("alb_https_cert");
  expect(plan.resources.edgeDistribution).toBeUndefined();
  expect(plan.resources.cloudfrontOrigin).toBeUndefined();
  expect(plan.resources.protectedAccessUrl).toBe("https://uptime.example.net");
  expect(plan.resources.originVerification).toMatchObject({
    mode: "alb_tls",
    requiredBeforeScaleUp: false,
    valueStoredInTerraformState: false,
  });
  expect(plan.resources.services.find((service) => service.role === "web")?.environment.HASNA_UPTIME_ALLOWED_ORIGINS)
    .toBe("https://uptime.example.net");
  expect(plan.runbook.deploy.join("\n")).toContain("Create Route53/edge record");
});

test("buildPrivateProbeCloudConfig references private key paths without inlining secrets", () => {
  const config = buildPrivateProbeCloudConfig({
    apiUrl: "https://uptime.example.com/api/v1",
    probeId: "prb_private_01",
    probePrivateKeyFile: "~/.hasna/uptime/probes/private-probe-01.key.pem",
  });
  const env = renderPrivateProbeEnv(config, { allowBlocked: true });
  const serialized = JSON.stringify(config);

  expect(config.kind).toBe("open-uptime.private-probe-cloud-config");
  expect(config.status).toBe("blocked");
  expect(config.canStart).toBe(false);
  expect(config.env.HASNA_UPTIME_MODE).toBe("hosted");
  expect(config.env.HASNA_UPTIME_PRIVATE_PROBE_ID).toBe("prb_private_01");
  expect(env).toContain("HASNA_UPTIME_API_URL=https://uptime.example.com/api/v1");
  expect(env).toContain("HASNA_UPTIME_PRIVATE_PROBE_KEY_FILE=~/.hasna/uptime/probes/private-probe-01.key.pem");
  expect(config.safety).toMatchObject({ privateKeyInline: false, tokenInline: false });
  expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("cloud-primary");
});

test("renderPrivateProbeEnv rejects missing cloud probe id", () => {
  const config = buildPrivateProbeCloudConfig();

  expect(config.env.HASNA_UPTIME_PRIVATE_PROBE_ID).toBeUndefined();
  expect(config.blockers[0]).toContain("Cloud-registered private probe id");
  expect(() => renderPrivateProbeEnv(config)).toThrow("private probe env output is blocked");
  expect(() => renderPrivateProbeEnv(config, { allowBlocked: true })).toThrow("HASNA_UPTIME_PRIVATE_PROBE_ID");
});
