// Token-aware output helpers for MCP tools. Domain results are returned as JSON
// text; the parity harness parses content[0].text back to a comparable value.

export function mcpText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function mcpError(envelope: { code: string; message: string; suggestion: string }) {
  return { content: [{ type: "text" as const, text: JSON.stringify(envelope) }], isError: true as const };
}
