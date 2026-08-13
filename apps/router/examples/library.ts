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

console.log(JSON.stringify(decision, null, 2));
