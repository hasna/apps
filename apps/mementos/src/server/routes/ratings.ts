// Memory rating routes.
//
// `memory_rate` wrote usefulness feedback into a per-station SQLite table, so
// the signal every agent was told to produce never reached the shared store
// and the usefulness ratio a station reported was its own keystrokes only.

import { rateMemory, listRatingsForMemory, getRatingsSummary } from "../../db/ratings.js";
import { addRoute } from "../router.js";
import { json, errorResponse, readJson } from "../helpers.js";

// POST /api/memories/:id/ratings — rate a memory
addRoute("POST", "/api/memories/:id/ratings", async (req, _url, params) => {
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const useful = body["useful"];
  if (typeof useful !== "boolean") {
    return errorResponse("useful is required and must be a boolean", 400);
  }
  const agentId = typeof body["agent_id"] === "string" ? (body["agent_id"] as string) : undefined;
  const context = typeof body["context"] === "string" ? (body["context"] as string) : undefined;
  const rating = rateMemory(params["id"]!, useful, agentId, context);
  return json({ rating, summary: getRatingsSummary(params["id"]!) }, 201);
});

// GET /api/memories/:id/ratings — the ratings and their summary
addRoute("GET", "/api/memories/:id/ratings", (_req, _url, params) => {
  const ratings = listRatingsForMemory(params["id"]!);
  return json({ ratings, count: ratings.length, summary: getRatingsSummary(params["id"]!) });
});
