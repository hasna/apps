import { expect, test } from "bun:test";
import { buildAwsDeploymentPlan, buildSpark01CloudConfig, renderSpark01Env } from "../src/cloud-plan.js";

test("buildAwsDeploymentPlan generates a dry-run hasna-xyz-infra plan", () => {
  const plan = buildAwsDeploymentPlan({
    image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/hasna/opensource/open-uptime:test",
  });
  const serialized = JSON.stringify(plan);

  expect(plan.kind).toBe("open-uptime.aws-deployment-plan");
  expect(plan.accountName).toBe("hasna-xyz-infra");
  expect(plan.region).toBe("us-east-1");
  expect(plan.resources.vpcId).toBe("vpc-04c7f7abc1d3c3f56");
  expect(plan.resources.rdsInstanceId).toBe("hasna-xyz-infra-apps-prod-postgres");
  expect(plan.status).toBe("blocked");
  expect(plan.canApply).toBe(false);
  expect(plan.image.dockerfile).toBe("Dockerfile");
  expect(plan.image.buildCommand).toContain("docker build");
  expect(buildAwsDeploymentPlan().image.uri).toContain("@sha256:<image-digest>");
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
  expect(plan.resources.services.find((service) => service.role === "web")?.targetDesiredCount).toBe(2);
  expect(plan.resources.services.find((service) => service.role === "web")?.secrets.HASNA_UPTIME_HOSTED_TOKEN)
    .toBe("hasna/xyz/opensource/uptime/prod/hosted-token");
  expect(plan.resources.services.find((service) => service.role === "web")?.secrets.HASNA_UPTIME_DATABASE_URL)
    .toBe("hasna/xyz/opensource/uptime/prod/rds");
  expect(plan.resources.services.find((service) => service.role === "public-probe")?.secrets.HASNA_UPTIME_DATABASE_URL)
    .toBeUndefined();
  expect(plan.resources.alarms).toEqual(["open-uptime-prod-web-5xx", "open-uptime-prod-web-unhealthy"]);
  expect(plan.safety).toMatchObject({
    liveAwsMutation: false,
    plaintextSecrets: false,
    hostedLocalSqliteAllowed: false,
  });
  expect(plan.blockers).toContain("Hosted Postgres storage adapter and migrations are not implemented.");
  expect(plan.blockers.join("\n")).not.toContain("no reviewed Dockerfile");
  expect(plan.requiredEvidence.length).toBeGreaterThan(3);
  expect(serialized).not.toContain("AWS_SECRET_ACCESS_KEY");
  expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  expect(serialized).not.toContain("aws ecr create-repository");
  expect(serialized).not.toContain("aws s3api create-bucket");
  expect(serialized).not.toContain("aws ecs create-cluster");
  expect(serialized).not.toContain("aws ecs update-service");
  expect(serialized).not.toContain("docker push ");
  expect(serialized).not.toContain("\"DATABASE_URL\"");
});

test("buildSpark01CloudConfig references private key paths without inlining secrets", () => {
  const config = buildSpark01CloudConfig({
    apiUrl: "https://uptime.hasna.xyz/api/v1",
    probeId: "prb_spark01",
    probePrivateKeyFile: "~/.hasna/uptime/probes/spark01.key.pem",
  });
  const env = renderSpark01Env(config);
  const serialized = JSON.stringify(config);

  expect(config.kind).toBe("open-uptime.spark01-cloud-config");
  expect(config.status).toBe("blocked");
  expect(config.canStart).toBe(false);
  expect(config.env.HASNA_UPTIME_MODE).toBe("hosted");
  expect(config.env.HASNA_UPTIME_PRIVATE_PROBE_ID).toBe("prb_spark01");
  expect(env).toContain("HASNA_UPTIME_API_URL=https://uptime.hasna.xyz/api/v1");
  expect(env).toContain("HASNA_UPTIME_PRIVATE_PROBE_KEY_FILE=~/.hasna/uptime/probes/spark01.key.pem");
  expect(config.safety).toMatchObject({ privateKeyInline: false, tokenInline: false });
  expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("cloud-primary");
});

test("renderSpark01Env rejects missing cloud probe id", () => {
  const config = buildSpark01CloudConfig();

  expect(config.env.HASNA_UPTIME_PRIVATE_PROBE_ID).toBeUndefined();
  expect(config.blockers[0]).toContain("Cloud-registered private probe id");
  expect(() => renderSpark01Env(config)).toThrow("HASNA_UPTIME_PRIVATE_PROBE_ID");
});
