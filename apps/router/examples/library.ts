import { loadRouterConfig, routePrompt } from "../src";

const config = await loadRouterConfig("router.config.example.json");

const decision = routePrompt({
  config,
  request: {
    model: "auto",
    messages: [{ role: "user", content: "Summarize this incident report as JSON with action items." }],
    response_format: { type: "json_object" },
    hints: {
      priority: "balanced",
      stickySessionId: "example-session",
    },
  },
});

const topScores = decision.scores
  .slice(0, 3)
  .map((score) => `${score.model}:${score.score.toFixed(3)}`)
  .join(", ");

console.log(`selected=${decision.selected?.model.id ?? "none"} status=${decision.status}`);
console.log(`scores=${topScores}`);
console.log(`details=${decision.scores.length} scores, ${decision.skipped.length} skipped candidates`);
