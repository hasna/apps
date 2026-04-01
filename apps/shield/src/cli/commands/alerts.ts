import type { Command } from "commander";
import chalk from "chalk";
import { getDb, getAdvisory, listAdvisories, getIOCsForAdvisory } from "../../db/index.js";
import { seedAdvisories } from "../../data/advisories.js";
import { AlertManager, loadAlertConfig, saveAlertConfig } from "../../alerts/index.js";

export function registerAlertsCommand(program: Command): void {
  const alertsCmd = program
    .command("alerts")
    .description("Manage alert channels for supply chain notifications");

  // alerts status
  alertsCmd
    .command("status")
    .description("Show current alert configuration and enabled channels")
    .action(() => {
      const config = loadAlertConfig();
      const manager = new AlertManager(config);

      console.log(chalk.bold("\n  Alert Pipeline Status\n"));
      console.log(chalk.gray("  " + "\u2500".repeat(50)));

      const enabled = config.enabled;
      console.log(`\n  Enabled: ${enabled ? chalk.green("yes") : chalk.red("no")}`);
      console.log(`  Min severity: ${chalk.yellow(config.min_severity)}`);

      const channels = manager.getChannelNames();
      if (channels.length > 0) {
        console.log(`\n  Active channels (${channels.length}):`);
        for (const ch of channels) {
          console.log(chalk.green(`    ✓ ${ch}`));
        }
      } else {
        console.log(chalk.gray("\n  No channels configured."));
        console.log(chalk.gray("  Set env vars or edit .security/alerts.json to add channels."));
      }

      console.log(chalk.gray("\n  Environment variables:"));
      const envVars = [
        ["SECURITY_SLACK_WEBHOOK_URL", "Slack"],
        ["SECURITY_DISCORD_WEBHOOK_URL", "Discord"],
        ["SECURITY_WEBHOOK_URL", "Generic webhook"],
        ["SECURITY_TWITTER_API_KEY", "Twitter (+ API_SECRET, ACCESS_TOKEN, ACCESS_TOKEN_SECRET)"],
        ["SECURITY_SMTP_HOST", "Email (+ SMTP_USER, SMTP_PASS, ALERT_FROM_EMAIL, ALERT_TO_EMAILS)"],
      ];
      for (const [envVar, label] of envVars) {
        const set = !!process.env[envVar];
        console.log(`    ${set ? chalk.green("✓") : chalk.gray("○")} ${envVar} — ${label}`);
      }
      console.log();
    });

  // alerts test [advisory-id]
  alertsCmd
    .command("test")
    .description("Send a test alert using a real or mock advisory")
    .argument("[id]", "Advisory ID to test with (uses first known advisory if not specified)")
    .action(async (id?: string) => {
      getDb();
      try { seedAdvisories(); } catch {}

      let advisory;
      if (id) {
        advisory = getAdvisory(id);
        if (!advisory) {
          console.error(chalk.red(`\n  Advisory not found: ${id}\n`));
          process.exit(1);
        }
      } else {
        const advisories = listAdvisories({ limit: 1 });
        if (advisories.length === 0) {
          console.error(chalk.red("\n  No advisories in DB. Run `security scan` first.\n"));
          process.exit(1);
        }
        advisory = advisories[0];
      }

      const iocs = getIOCsForAdvisory(advisory.id).map((i) => ({
        type: i.type,
        value: i.value,
        context: i.context,
      }));

      const config = loadAlertConfig();
      // Force-enable for testing and auto-detect env vars
      const testConfig = { ...config, enabled: true, channels: { ...config.channels } };
      if (process.env.SECURITY_SLACK_WEBHOOK_URL) testConfig.channels.slack = { enabled: true };
      if (process.env.SECURITY_DISCORD_WEBHOOK_URL) testConfig.channels.discord = { enabled: true };
      if (process.env.SECURITY_WEBHOOK_URL) testConfig.channels.webhook = { enabled: true };
      if (process.env.SECURITY_TWITTER_API_KEY) testConfig.channels.twitter = { enabled: true };
      if (process.env.SECURITY_SMTP_HOST) testConfig.channels.email = { enabled: true };
      const manager = new AlertManager(testConfig);
      const channels = manager.getChannelNames();

      if (channels.length === 0) {
        console.log(chalk.yellow("\n  No alert channels configured. Set env vars to enable:\n"));
        console.log(chalk.gray("    SECURITY_SLACK_WEBHOOK_URL=https://hooks.slack.com/..."));
        console.log(chalk.gray("    SECURITY_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/..."));
        console.log(chalk.gray("    SECURITY_WEBHOOK_URL=https://your-api.example.com/security-alert\n"));
        process.exit(1);
      }

      console.log(chalk.bold(`\n  Sending test alert for: ${advisory.package_name} (${advisory.severity})\n`));
      console.log(chalk.gray(`  Channels: ${channels.join(", ")}\n`));

      const results = await manager.alert(advisory, iocs);

      for (const result of results) {
        if (result.success) {
          console.log(chalk.green(`  ✓ ${result.channel}: ${result.message}`));
          if (result.url) console.log(chalk.gray(`    URL: ${result.url}`));
        } else {
          console.log(chalk.red(`  ✗ ${result.channel}: ${result.message}`));
        }
      }
      console.log();
    });

  // alerts enable / disable
  alertsCmd
    .command("enable")
    .description("Enable alerts globally")
    .option("--severity <level>", "Minimum severity to alert on (critical/high/medium)", "critical")
    .action((options) => {
      const config = loadAlertConfig();
      config.enabled = true;
      config.min_severity = options.severity as AlertConfig["min_severity"];
      saveAlertConfig(config);
      console.log(chalk.green(`\n  Alerts enabled (min severity: ${options.severity})\n`));
    });

  alertsCmd
    .command("disable")
    .description("Disable alerts")
    .action(() => {
      const config = loadAlertConfig();
      config.enabled = false;
      saveAlertConfig(config);
      console.log(chalk.yellow("\n  Alerts disabled.\n"));
    });
}

// Avoid TS complaints about type reference in the enable action
type AlertConfig = import("../../alerts/index.js").AlertConfig;
