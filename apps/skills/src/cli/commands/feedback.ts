import chalk from "chalk";
import type { Command } from "commander";
import pkg from "../../../package.json" with { type: "json" };
import { saveFeedback, type FeedbackCategory } from "../../lib/feedback.js";

export function registerFeedback(parent: Command) {
  parent
    .command("feedback")
    .argument("<message...>", "Feedback message")
    .option("--category <category>", "Feedback category: bug, feature, or general", "general")
    .option("--email <email>", "Contact email for follow-up")
    .option("--agent <name>", "Agent name sending feedback")
    .option("--json", "Output as JSON", false)
    .description("Send feedback from an agent or local CLI session")
    .action(async (messageParts: string[], options: { category: string; email?: string; agent?: string; json: boolean }) => {
      const category = options.category as FeedbackCategory;
      if (!["bug", "feature", "general"].includes(category)) {
        const error = `Invalid category: ${options.category}. Use bug, feature, or general.`;
        if (options.json) console.log(JSON.stringify({ saved: false, error }));
        else console.error(chalk.red(error));
        process.exitCode = 1;
        return;
      }

      try {
        // Hosted by default: saveFeedback() posts to /api/v1/feedback on the
        // configured instance and only writes this machine under the explicit
        // local opt-in. A refusal from the credential ladder lands in the catch
        // below and exits non-zero - never a local write standing in for a send.
        const result = await saveFeedback({
          message: messageParts.join(" "),
          category,
          email: options.email,
          agent: options.agent,
          version: pkg.version,
        });
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else if (result.target === "hosted") console.log(chalk.green(`✓ Feedback sent (${result.category}) — ${result.id}`));
        else console.log(chalk.green(`✓ Feedback saved locally (${result.category})`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) console.log(JSON.stringify({ saved: false, error: message }));
        else console.error(chalk.red(message));
        process.exitCode = 1;
      }
    });
}
