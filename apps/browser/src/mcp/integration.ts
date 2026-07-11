// ─── Integration and meta tools ──────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerTool,
  z,
  json,
  err,
  resolveSessionId,
  getSessionPage,
} from "./helpers.js";

export function registerIntegrationAndMeta(server: McpServer) {
  // ── open-* Integration Tools ────────────────────────────────────────────────

  registerTool(server,
    "browser_secrets_login",
    "Login to a service using credentials from open-secrets vault or ~/.secrets.",
    { session_id: z.string().optional(), service: z.string(), login_url: z.string().optional(), save_profile: z.boolean().optional().default(true) },
    async ({ session_id, service, login_url, save_profile }) => {
      try {
        const sid = resolveSessionId(session_id);
        const page = getSessionPage(sid);
        const { lookupCredentials, loginWithCredentials } = await import("../lib/auth.js");
        const { credential: creds, method } = await lookupCredentials(service);
        if (!creds) return err(new Error(`No credentials found for '${service}'. Add them: secrets set ${service}_email yourlogin && secrets set ${service}_password yourpass`));
        const result = await loginWithCredentials(page as any, creds, {
          loginUrl: login_url,
          saveProfile: save_profile ? service : undefined,
          method,
        });
        return json(result);
      } catch (e) { return err(e); }
    }
  );

  registerTool(server,
    "browser_remember",
    "Store page facts in open-mementos for future recall.",
    { session_id: z.string().optional(), facts: z.record(z.unknown()), tags: z.array(z.string()).optional() },
    async ({ session_id, facts, tags }) => {
      try {
        const sid = resolveSessionId(session_id);
        const page = getSessionPage(sid);
        const { rememberPage } = await import("../lib/page-memory.js");
        const url = page.url();
        await rememberPage(url, facts, tags);
        return json({ remembered: true, url, facts_count: Object.keys(facts).length });
      } catch (e) { return err(e); }
    }
  );

  registerTool(server,
    "browser_recall",
    "Retrieve cached page facts from open-mementos.",
    { url: z.string(), max_age_hours: z.number().optional().default(24) },
    async ({ url, max_age_hours }) => {
      try {
        const { recallPage } = await import("../lib/page-memory.js");
        const memory = await recallPage(url, max_age_hours);
        return json({ found: !!memory, memory });
      } catch (e) { return err(e); }
    }
  );

  registerTool(server,
    "browser_session_announce",
    "Announce to other agents via open-conversations what this session is browsing.",
    { session_id: z.string().optional(), message: z.string().optional() },
    async ({ session_id, message }) => {
      try {
        const sid = resolveSessionId(session_id);
        const page = getSessionPage(sid);
        const { announceNavigation } = await import("../lib/coordination.js");
        const url = page.url();
        await announceNavigation(url, sid);
        return json({ announced: true, url, message });
      } catch (e) { return err(e); }
    }
  );

  registerTool(server,
    "browser_check_navigation",
    "Check if another agent is already scraping this URL.",
    { url: z.string() },
    async ({ url }) => {
      try {
        const { checkDuplicate } = await import("../lib/coordination.js");
        return json(await checkDuplicate(url));
      } catch (e) { return err(e); }
    }
  );

  registerTool(server,
    "browser_skill_run",
    "Run a pre-built browser skill (login, extract-pricing, monitor-price, etc.).",
    { session_id: z.string().optional(), skill: z.string(), params: z.record(z.unknown()).optional().default({}) },
    async ({ session_id, skill, params }) => {
      try {
        const sid = resolveSessionId(session_id);
        const page = getSessionPage(sid);
        const { runBrowserSkill } = await import("../lib/skills-runner.js");
        return json(await runBrowserSkill(skill, params, page as any));
      } catch (e) { return err(e); }
    }
  );

  registerTool(server,
    "browser_skill_list",
    "List available browser skills.",
    {},
    async () => {
      try {
        const { listBuiltInSkills } = await import("../lib/skills-runner.js");
        return json({ skills: listBuiltInSkills() });
      } catch (e) { return err(e); }
    }
  );

  registerTool(server,
    "browser_pool_status",
    "Get status of the pre-warmed browser session pool.",
    {},
    async () => {
      try {
        return json({ message: "Session pool not yet implemented in this version.", ready: 0, total: 0 });
      } catch (e) { return err(e); }
    }
  );
}
