import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("Dockerfile builds a hosted non-root Bun runtime without plaintext secrets", () => {
  const dockerfile = read("Dockerfile");

  expect(dockerfile).toContain("FROM oven/bun:1.3.13-slim AS build");
  expect(dockerfile).toContain("bun run build");
  expect(dockerfile).toContain("HASNA_UPTIME_MODE=hosted");
  expect(dockerfile).toContain("USER uptime");
  expect(dockerfile).toContain("HEALTHCHECK");
  expect(dockerfile).not.toContain("HASNA_UPTIME_HOSTED_TOKEN=");
  expect(dockerfile).not.toContain("DATABASE_URL=");
  expect(dockerfile).not.toContain("AWS_SECRET_ACCESS_KEY");
});

test("AWS infra templates use secret refs and keep services scaled down by default", () => {
  const main = read("infra/aws/main.tf");
  const variables = read("infra/aws/variables.tf");
  const tfvars = read("infra/aws/terraform.tfvars.example");
  const combined = [main, variables, tfvars].join("\n");

  expect(main).toContain('resource "aws_ecs_cluster" "open_uptime"');
  expect(main).toContain('resource "aws_ecs_task_definition" "service"');
  expect(main).toContain("valueFrom");
  expect(main).toContain('image_tag_mutability = "IMMUTABLE"');
  expect(main).toContain("HASNA_UPTIME_HOSTED_TOKEN");
  expect(main).toContain("HASNA_UPTIME_DATABASE_URL");
  expect(main).toContain('resource "aws_iam_role_policy" "execution_secrets"');
  expect(main).toContain('resource "aws_security_group" "worker"');
  expect(main).toContain('key != "web" && key != "migration"');
  expect(main).toContain('each.key == "public-probe" ? ["0.0.0.0/0"] : [data.aws_vpc.target.cidr_block]');
  expect(variables).toContain("hosted_token_secret_arn");
  expect(variables).toContain('"public-probe" = 0');
  expect(main).toContain("aws_s3_bucket_public_access_block");
  expect(main).toContain("aws_s3_bucket_lifecycle_configuration");
  expect(main).toContain("DenyInsecureTransport");
  expect(main).toContain("deployment_circuit_breaker");
  expect(main).toContain('resource "aws_cloudwatch_metric_alarm" "web_5xx"');
  expect(main).toContain('resource "aws_cloudwatch_metric_alarm" "web_unhealthy"');
  expect(variables).toContain("web            = 0");
  expect(tfvars).toContain("container_image");
  expect(tfvars).toContain("@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(tfvars).toContain("kms_key_arn");
  expect(tfvars).toContain('"public-probe" = 0');
  expect(tfvars).not.toContain("public_probe = 0");
  expect(combined).not.toContain("AKIA");
  expect(combined).not.toContain("BEGIN PRIVATE KEY");
  expect(combined).not.toContain("postgres://");
  expect(combined).not.toContain("HASNA_UPTIME_HOSTED_TOKEN=");
});
