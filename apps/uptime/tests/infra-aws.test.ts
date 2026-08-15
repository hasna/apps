import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function extractTerraformBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  expect(open).toBeGreaterThan(start);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`Could not find complete Terraform block for ${header}`);
}

test("AWS Terraform keeps worker runtime alarms default-off and named", () => {
  const main = readFileSync(join(root, "infra/aws/main.tf"), "utf8");
  const variables = readFileSync(join(root, "infra/aws/variables.tf"), "utf8");
  const outputs = readFileSync(join(root, "infra/aws/outputs.tf"), "utf8");
  const tfvars = readFileSync(join(root, "infra/aws/terraform.tfvars.example"), "utf8");

  const enableBlock = extractTerraformBlock(variables, 'variable "enable_worker_runtime_alarms"');
  const metricProducersBlock = extractTerraformBlock(variables, 'variable "worker_runtime_metric_producers_ready"');
  const namespaceBlock = extractTerraformBlock(variables, 'variable "worker_runtime_alarm_namespace"');
  const alarmResourceBlock = extractTerraformBlock(main, 'resource "aws_cloudwatch_metric_alarm" "worker_runtime"');
  const alarmNamesOutput = extractTerraformBlock(outputs, 'output "alarm_names"');
  const workerAlarmNamesOutput = extractTerraformBlock(outputs, 'output "worker_runtime_alarm_names"');
  const workerAlarmContractOutput = extractTerraformBlock(outputs, 'output "worker_runtime_alarm_contract"');

  expect(enableBlock).toContain("type        = bool");
  expect(enableBlock).toContain("default     = false");
  expect(enableBlock).toContain("!var.enable_worker_runtime_alarms");
  expect(enableBlock).toContain("var.worker_runtime_metric_producers_ready");
  expect(enableBlock).toContain("var.live_ops_human_alert_delivery_ready");
  expect(enableBlock).toContain("length(var.alarm_actions) > 0");
  expect(enableBlock).toContain("enable_worker_runtime_alarms requires worker_runtime_metric_producers_ready=true");
  expect(metricProducersBlock).toContain("type        = bool");
  expect(metricProducersBlock).toContain("default     = false");
  expect(namespaceBlock).toContain('default     = "OpenUptime/Worker"');
  expect(tfvars).toContain("enable_worker_runtime_alarms = false");
  expect(tfvars).toContain("worker_runtime_metric_producers_ready = false");
  expect(tfvars).toContain('worker_runtime_alarm_namespace = "OpenUptime/Worker"');

  expect(main).toContain("worker_runtime_alarms = {");
  for (const key of [
    "scheduler_backlog",
    "scheduler_stale_leases",
    "scheduler_heartbeat_age",
    "public_probe_backlog",
    "public_probe_submission_failures",
    "public_probe_heartbeat_age",
    "reporter_lag",
    "reporter_failed_deliveries",
    "reporter_retry_exhausted",
    "reporter_heartbeat_age",
  ]) {
    expect(main).toContain(key);
  }
  expect(alarmResourceBlock).toContain('for_each = var.enable_worker_runtime_alarms ? local.worker_runtime_alarms : {}');
  expect(alarmResourceBlock).toContain("namespace           = var.worker_runtime_alarm_namespace");
  expect(alarmResourceBlock).not.toContain("Workspace = var.workspace_id");
  expect(alarmResourceBlock).toContain("Stage   = var.stage");
  expect(alarmResourceBlock).toContain("Role    = each.value.role");
  expect(alarmNamesOutput).toContain("web_5xx");
  expect(alarmNamesOutput).toContain("web_unhealthy");
  expect(alarmNamesOutput).not.toContain("worker_runtime");
  expect(workerAlarmNamesOutput).toContain("aws_cloudwatch_metric_alarm.worker_runtime");
  expect(workerAlarmContractOutput).toContain('dimensions               = ["Service", "Stage", "Role"]');
  expect(workerAlarmContractOutput).toContain("metric_producers_ready");
  expect(workerAlarmContractOutput).toContain("human_alerts_ready");
  expect(workerAlarmContractOutput).toContain("alarm_actions_configured");
});
