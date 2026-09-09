import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { setupPreviews, registerPreviewStation } from "../../preview/cloudflare.js";
import { doctorPreview, downPreviews, ensurePreviewStationRunning, listPreviews, previewOAuth, previewStatus, upPreviews } from "../../preview/service.js";

type Helpers = { shouldRegisterTool: (name: string) => boolean; formatError: (error: unknown) => string };
const selection = { app: z.string().optional().describe("Explicit product/app"), product: z.string().optional(), manifest: z.string().optional(), environment: z.string().default("dev"), name: z.string().default("main") };
export function registerPreviewTools(server: McpServer, helpers: Helpers): void {
  const register = <T extends z.ZodRawShape>(name: string, description: string, shape: T, handler: (args: z.infer<z.ZodObject<T>>) => unknown) => {
    if (!helpers.shouldRegisterTool(name)) return;
    server.tool(name, description, shape as z.ZodRawShape, async (args) => {
      try { return { content: [{ type: "text" as const, text: JSON.stringify(await handler(args as z.infer<z.ZodObject<T>>), null, 2) }] }; }
      catch (error) { return { isError: true, content: [{ type: "text" as const, text: helpers.formatError(error) }] }; }
    });
  };
  register("setup_previews", "Provision the shared workers.dev preview router; requires Cloudflare Access onboarding and environment-backed credentials. dryRun makes no changes.", { accountId: z.string().optional(), subdomain: z.string().optional(), accessTeamDomain: z.string().optional(), accessEmails: z.array(z.string().email()).optional(), routerName: z.string().optional(), dryRun: z.boolean().default(false) }, setupPreviews);
  register("register_preview_station", "Enroll this workstation's one Cloudflare Tunnel and VPC gateway.", { name: z.string().optional(), gatewayPort: z.number().int().optional(), dryRun: z.boolean().default(false) }, registerPreviewStation);
  register("start_preview_station", "Start this workstation's managed tunnel and gateway without exposing an app.", {}, () => ensurePreviewStationRunning());
  register("up_previews", "Start declared local apps and claim stable protected workers.dev previews after readiness; takeover must be explicit.", { ...selection, takeover: z.boolean().default(false), port: z.number().int().optional(), dryRun: z.boolean().default(false) }, upPreviews);
  register("list_previews", "List remote app preview identities and active workstation ownership.", { product: z.string().optional() }, ({ product }) => listPreviews(product));
  register("get_preview_status", "Inspect a permanent product/app preview's active workstation and lease.", { ...selection, app: z.string() }, previewStatus);
  register("down_previews", "Release this station's preview exposure; only stop the app when stop is true.", { ...selection, stop: z.boolean().default(false) }, downPreviews);
  register("doctor_preview", "Check environment credential references, local gateway, VPC connectivity and ownership without printing credentials.", selection, doctorPreview);
  register("get_preview_oauth", "Show exact configured development callback URLs and JavaScript origins; never changes OAuth provider settings.", selection, previewOAuth);
}
