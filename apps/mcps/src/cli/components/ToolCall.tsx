import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { connectToServer, callTool } from "../../lib/proxy.js";
import { TOOL_PREFIX_SEPARATOR } from "../../lib/config.js";
import type { McpServerEntry, McpTool } from "../../types.js";

interface Props {
  server: McpServerEntry;
  tool: McpTool;
  onBack: () => void;
}

export function ToolCall({ server, tool, onBack }: Props) {
  const [argsInput, setArgsInput] = useState("{}");
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (value: string) => {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(value);
    } catch {
      setError("Invalid JSON. Please enter valid JSON arguments.");
      return;
    }

    setCalling(true);
    setError(null);
    setResult(null);

    try {
      await connectToServer(server);
      const prefixed = `${server.id}${TOOL_PREFIX_SEPARATOR}${tool.name}`;
      const res = await callTool(prefixed, args);
      const text = res.content.map((c) => c.text).join("\n");
      setResult(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCalling(false);
    }
  };

  const schema = tool.input_schema;
  const properties = (schema as any)?.properties || {};
  const required = (schema as any)?.required || [];

  return (
    <Box flexDirection="column">
      <Text bold>
        Call: {tool.name}
      </Text>
      <Text dimColor>Server: {server.name} [{server.id}]</Text>
      {tool.description && <Text dimColor>{tool.description}</Text>}

      {Object.keys(properties).length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Parameters:</Text>
          {Object.entries(properties).map(([key, val]: [string, any]) => (
            <Text key={key} dimColor>
              {required.includes(key) ? "* " : "  "}
              {key}: {val.type || "any"}
              {val.description ? ` — ${val.description}` : ""}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text>Args (JSON): </Text>
        <TextInput
          value={argsInput}
          onChange={setArgsInput}
          onSubmit={handleSubmit}
          placeholder='{"key": "value"}'
        />
      </Box>

      {calling && (
        <Box marginTop={1}>
          <Text>
            <Spinner type="dots" /> Calling...
          </Text>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {result && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Result:</Text>
          <Text>{result}</Text>
        </Box>
      )}
    </Box>
  );
}
