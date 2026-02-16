import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { getCachedTools } from "../../lib/registry.js";
import { connectToServer, disconnectServer } from "../../lib/proxy.js";
import type { McpServerEntry, McpTool } from "../../types.js";

interface Props {
  server: McpServerEntry;
  onSelectTool: (tool: McpTool) => void;
  onBack: () => void;
}

export function ServerDetail({ server, onSelectTool, onBack }: Props) {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedTools = getCachedTools(server.id);
  const cachedKey = cachedTools
    .map((t) => `${t.name}|${t.description}|${JSON.stringify(t.input_schema)}`)
    .join(";");

  useEffect(() => {
    setLoading(false);
    setError(null);
    if (cachedTools.length > 0) {
      setTools(
        cachedTools.map((t) => ({
          server_id: server.id,
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        }))
      );
    } else {
      setTools([]);
    }
  }, [server.id, cachedKey]);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const conn = await connectToServer(server);
      setTools(conn.tools);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const items = [
    ...(tools.length === 0 && !loading
      ? [{ label: "Connect & fetch tools", value: "__connect" }]
      : []),
    ...tools.map((t) => ({
      label: `${t.name} — ${t.description || "No description"}`,
      value: t.name,
      tool: t,
    })),
    { label: "← Back", value: "__back" },
  ];

  const handleSelect = (item: any) => {
    if (item.value === "__back") {
      disconnectServer(server.id);
      onBack();
    } else if (item.value === "__connect") {
      handleConnect();
    } else if (item.tool) {
      onSelectTool(item.tool);
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>{server.name}</Text>
      <Text dimColor>ID: {server.id}</Text>
      <Text dimColor>
        Status: {server.enabled ? "enabled" : "disabled"} | Transport: {server.transport}
      </Text>
      <Text dimColor>
        Command: {server.command} {server.args.join(" ")}
      </Text>
      {server.description && <Text dimColor>{server.description}</Text>}

      <Box marginTop={1} flexDirection="column">
        {loading ? (
          <Text>
            <Spinner type="dots" /> Connecting...
          </Text>
        ) : error ? (
          <Text color="red">Error: {error}</Text>
        ) : (
          <>
            <Text bold>
              {tools.length > 0 ? `Tools (${tools.length}):` : "Tools:"}
            </Text>
            <SelectInput items={items} onSelect={handleSelect} />
          </>
        )}
      </Box>
    </Box>
  );
}
