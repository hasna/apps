import { getLocalMachineId } from "../db.js";
import { getPackageVersion } from "../version.js";
import { diffApps, listApps } from "./apps.js";
import { runDoctor } from "./doctor.js";
import { buildClaudeInstallPlan } from "./install-claude.js";
import { listNotificationChannels } from "./notifications.js";
import { getServeInfo, renderDashboardHtml } from "./serve.js";
import { getStatus } from "./status.js";
import type { SelfTestCheck, SelfTestResult } from "../types.js";

function check(id: string, status: SelfTestCheck["status"], summary: string, detail: string): SelfTestCheck {
  return { id, status, summary, detail };
}

export function runSelfTest(): SelfTestResult {
  const version = getPackageVersion();
  const status = getStatus();
  const doctor = runDoctor();
  const serveInfo = getServeInfo();
  const html = renderDashboardHtml();
  const notifications = listNotificationChannels();
  const apps = listApps(status.machineId);
  const appsDiff = diffApps(status.machineId);
  const cliPlan = buildClaudeInstallPlan(status.machineId);

  return {
    machineId: getLocalMachineId(),
    checks: [
      check("package-version", version === "0.0.0" ? "fail" : "ok", "Package version resolves", version),
      check(
        "status",
        "ok",
        "Status loads",
        JSON.stringify({ machines: status.manifestMachineCount, heartbeats: status.heartbeatCount })
      ),
      check(
        "doctor",
        doctor.checks.some((entry) => entry.status === "fail") ? "warn" : "ok",
        "Doctor completed",
        `${doctor.checks.length} checks`
      ),
      check("serve-info", "ok", "Dashboard info renders", `${serveInfo.url} routes=${serveInfo.routes.length}`),
      check(
        "dashboard-html",
        html.includes("Machines Dashboard") ? "ok" : "fail",
        "Dashboard HTML renders",
        html.slice(0, 80)
      ),
      check("notifications", "ok", "Notifications config loads", `${notifications.channels.length} channels`),
      check("apps", "ok", "Apps manifest loads", `${apps.apps.length} apps`),
      check(
        "apps-diff",
        appsDiff.missing.length === 0 ? "ok" : "warn",
        "Apps diff computed",
        `missing=${appsDiff.missing.length} installed=${appsDiff.installed.length}`
      ),
      check(
        "install-claude-plan",
        cliPlan.steps.length > 0 ? "ok" : "warn",
        "Install plan renders",
        `${cliPlan.steps.length} steps`
      ),
    ],
  };
}
