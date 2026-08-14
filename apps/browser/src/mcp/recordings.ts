// ─── Recording, crawl, and auth flow tools ───────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compactList, truncateText } from "./compact.js";
import {
  registerTool,
  z,
  json,
  err,
  resolveSessionId,
  getSessionPage,
  navigate,
  startRecording,
  stopRecording,
  replayRecording,
  recordStep,
  crawl,
  listRecordings,
} from "./helpers.js";
import type { BrowserEngine } from "./helpers.js";

export function register(server: McpServer) {

// ── Recording Tools ───────────────────────────────────────────────────────────

registerTool(server,
  "browser_record_start",
  "Start recording actions in a session",
  { session_id: z.string().optional(), name: z.string(), project_id: z.string().optional() },
  async ({ session_id, name }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const recording = startRecording(sid, name, page.url());
      return json({ recording_id: recording.id, name: recording.name });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_record_step",
  "Manually add a step to an active recording",
  {
    recording_id: z.string(),
    type: z.enum(["navigate", "click", "type", "scroll", "hover", "select", "check", "wait"]),
    selector: z.string().optional(),
    value: z.string().optional(),
    url: z.string().optional(),
  },
  async ({ recording_id, type, selector, value, url }) => {
    try {
      recordStep(recording_id, { type, selector, value, url });
      return json({ recorded: type });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_record_stop",
  "Stop recording and save the recording",
  { recording_id: z.string() },
  async ({ recording_id }) => {
    try {
      const recording = stopRecording(recording_id);
      return json({ recording, steps: recording.steps.length });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_record_replay",
  "Replay a recorded sequence in a session",
  { session_id: z.string().optional(), recording_id: z.string() },
  async ({ session_id, recording_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await replayRecording(recording_id, page);
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_recordings_list",
  "List recordings. Compact by default; set verbose=true for full recording records.",
  { project_id: z.string().optional(), limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ project_id, limit, offset, verbose }) => {
    try {
      const recordings = listRecordings(project_id);
      if (verbose) {
        const page = compactList(recordings, limit, (recording) => recording, { offset });
        return json({ recordings: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(recordings, limit, (recording) => ({
        id: recording.id,
        name: recording.name,
        project_id: recording.project_id,
        start_url: truncateText(recording.start_url, 140) || undefined,
        steps: recording.steps.length,
        created_at: recording.created_at,
      }), {
        offset,
        hint: "Set verbose=true for full steps, or use browser_record_export for a specific recording.",
      });
      return json({ recordings: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

// ── Crawl Tools ───────────────────────────────────────────────────────────────

registerTool(server,
  "browser_crawl",
  "Crawl a URL recursively and return discovered pages",
  {
    url: z.string(),
    max_depth: z.number().optional().default(2),
    max_pages: z.number().optional().default(50),
    same_domain: z.boolean().optional().default(true),
    project_id: z.string().optional(),
    engine: z.enum(["playwright", "cdp", "lightpanda", "bun", "tui", "kernel", "auto"]).optional().default("auto"),
  },
  async ({ url, max_depth, max_pages, same_domain, project_id, engine }) => {
    try {
      const result = await crawl(url, {
        maxDepth: max_depth,
        maxPages: max_pages,
        sameDomain: same_domain,
        projectId: project_id,
        engine: engine as BrowserEngine,
      });
      return json(result);
    } catch (e) { return err(e); }
  }
);

// ── Auth Flow Tools ──────────────────────────────────────────────────────────

registerTool(server,
  "browser_auth_record",
  "Start recording a login flow. Navigate to the login page, perform the login, then call browser_auth_stop to save.",
  { session_id: z.string().optional(), name: z.string().describe("Name for this auth flow (e.g. 'github', 'gmail')"), start_url: z.string().optional().describe("Login page URL") },
  async ({ session_id, name, start_url }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      if (start_url) await navigate(page, start_url);
      const recording = startRecording(sid, `auth-${name}`, page.url());
      return json({ recording_id: recording.id, name, message: "Recording started. Perform login, then call browser_auth_stop." });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_auth_stop",
  "Stop recording a login flow and save as a reusable auth flow with storage state.",
  { session_id: z.string().optional(), name: z.string(), recording_id: z.string() },
  async ({ session_id, name, recording_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const recording = stopRecording(recording_id);
      // Save storage state
      const { saveStateFromPage } = await import("../lib/storage-state.js");
      const statePath = await saveStateFromPage(page, name);
      // Extract domain
      let domain = "";
      try { domain = new URL(page.url()).hostname; } catch {}
      // Save auth flow
      const { saveAuthFlow } = await import("../lib/auth-flow.js");
      const flow = saveAuthFlow({ name, domain, recordingId: recording.id, storageStatePath: statePath });
      return json({ flow, recording_steps: recording.steps.length });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_auth_replay",
  "Manually replay a saved auth flow for a domain",
  { session_id: z.string().optional(), name: z.string().describe("Auth flow name to replay") },
  async ({ session_id, name }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { getAuthFlowByName, tryReplayAuth } = await import("../lib/auth-flow.js");
      const flow = getAuthFlowByName(name);
      if (!flow) return err(new Error(`Auth flow '${name}' not found`));
      const result = await tryReplayAuth(page, flow.domain);
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_auth_list",
  "List saved auth flows. Compact by default; set verbose=true for full records.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const { listAuthFlows } = await import("../lib/auth-flow.js");
      const flows = listAuthFlows();
      if (verbose) {
        const page = compactList(flows, limit, (flow: any) => flow, { offset });
        return json({ flows: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(flows, limit, (flow: any) => ({
        name: flow.name,
        domain: flow.domain,
        recording_id: flow.recording_id,
        created_at: flow.created_at,
        updated_at: flow.updated_at,
      }), {
        offset,
        hint: "Set verbose=true for full auth-flow metadata.",
      });
      return json({ flows: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_auth_delete",
  "Delete a saved auth flow",
  { name: z.string() },
  async ({ name }) => {
    try {
      const { deleteAuthFlow } = await import("../lib/auth-flow.js");
      return json({ deleted: deleteAuthFlow(name) });
    } catch (e) { return err(e); }
  }
);

// ── Export Recording ──────────────────────────────────────────────────────────

registerTool(server,
  "browser_record_export",
  "Export a recording as a Playwright test (.spec.ts), Puppeteer automation file, or JSON. Returns the generated artifact as text.",
  {
    recording_id: z.string().describe("ID of the recording to export"),
    format: z.enum(["playwright", "puppeteer", "json"]).optional().default("playwright").describe("Export format"),
  },
  async ({ recording_id, format }) => {
    try {
      const { exportRecording } = await import("../lib/recorder.js");
      const code = exportRecording(recording_id, format);
      const ext = format === "json" ? ".json" : format === "playwright" ? ".spec.ts" : ".js";
      return json({ format, filename: `recording-${recording_id}${ext}`, code });
    } catch (e) { return err(e); }
  }
);

} // end register
