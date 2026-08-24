import { runSynthesis, rollbackSynthesis, getSynthesisStatus } from "../../lib/synthesis/index.js";
import { listSynthesisRuns } from "../../db/synthesis.js";
import { synthesizeProfile } from "../../lib/profile-synthesizer.js";
import { addRoute } from "../router.js";
import { json, readJson } from "../helpers.js";

export function registerSystemSynthesisRoutes(): void {
  addRoute("POST", "/api/synthesis/run", async (req) => {
    const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
    try {
      const result = await runSynthesis({
        projectId: body.project_id as string | undefined,
        agentId: body.agent_id as string | undefined,
        dryRun: body.dry_run as boolean | undefined,
        maxProposals: body.max_proposals as number | undefined,
        provider: body.provider as string | undefined,
      });
      return json(result, result.dryRun ? 200 : 201);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  addRoute("GET", "/api/synthesis/runs", (_req, url) => {
    const projectId = url.searchParams.get("project_id") ?? undefined;
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : 20;
    const runs = listSynthesisRuns({ project_id: projectId, limit });
    return json({ runs, count: runs.length });
  });

  addRoute("GET", "/api/synthesis/status", (_req, url) => {
    const projectId = url.searchParams.get("project_id") ?? undefined;
    const runId = url.searchParams.get("run_id") ?? undefined;
    return json(getSynthesisStatus(runId, projectId));
  });

  addRoute("POST", "/api/synthesis/rollback/:run_id", async (_req, _url, params) => {
    try {
      const result = await rollbackSynthesis(params["run_id"]!);
      return json(result);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // POST (not GET): the handler writes a `_profile_*` cache memory and fires an
  // LLM call (spend). GET is a CORS simple request — a hostile cross-origin
  // page could trigger it with no preflight — so it must go through the
  // state-changing origin/Host and auth gates instead.
  addRoute("POST", "/api/profile/synthesize", async (req) => {
    const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
    try {
      const result = await synthesizeProfile({
        project_id: body["project_id"] as string | undefined,
        agent_id: body["agent_id"] as string | undefined,
        force_refresh: body["force_refresh"] === true,
      });

      if (!result) {
        return json({ profile: null, message: "No preference/fact memories found to synthesize" });
      }

      return json(result);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
