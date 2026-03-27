import { Command } from "commander";
import { compareRuns, printDiffReport, toMarkdown } from "../../core/reporter.js";
import { getRun, getBaseline } from "../../db/store.js";

export function compareCommand(): Command {
  return new Command("compare")
    .description("Compare two eval runs side-by-side")
    .argument("<before>", "Before run ID or baseline name")
    .argument("<after>", "After run ID (or 'latest')")
    .option("--json", "Output JSON diff")
    .option("--markdown", "Output markdown diff")
    .action(async (beforeArg: string, afterArg: string, opts: Record<string, string>) => {
      const { listRuns } = await import("../../db/store.js");

      const beforeRun = getRun(beforeArg) ?? getBaseline(beforeArg);
      const afterRun = afterArg === "latest"
        ? listRuns(1)[0]
        : getRun(afterArg) ?? getBaseline(afterArg);

      if (!beforeRun) { console.error(`Run/baseline not found: ${beforeArg}`); process.exit(1); }
      if (!afterRun)  { console.error(`Run/baseline not found: ${afterArg}`); process.exit(1); }

      const diff = compareRuns(beforeRun, afterRun);

      if (opts["json"]) {
        console.log(JSON.stringify(diff, null, 2));
      } else if (opts["markdown"]) {
        console.log(toMarkdown(afterRun));
        console.log("\n## Diff\n");
        printDiffReport(diff);
      } else {
        printDiffReport(diff);
      }

      process.exit(diff.regressions.length > 0 ? 1 : 0);
    });
}
