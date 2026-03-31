export type Args = Record<string, unknown>;
export type McpResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
export type ToolHandler = (a: Args) => McpResult | Promise<McpResult>;
