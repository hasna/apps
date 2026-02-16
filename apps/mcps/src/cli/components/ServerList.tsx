import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { listServers, getToolCounts } from "../../lib/registry.js";
import type { McpServerEntry } from "../../types.js";

interface Props {
  onSelect: (server: McpServerEntry) => void;
  onSearch: () => void;
}

export function ServerList({ onSelect, onSearch }: Props) {
  const servers = listServers();
  const toolCounts = getToolCounts();

  useInput((input) => {
    if (input === "s") {
      onSearch();
    }
  });

  if (servers.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No servers registered.</Text>
        <Text dimColor>Press "s" to search the MCP registry, or use `mcps add` to add a server.</Text>
      </Box>
    );
  }

  const items = servers.map((s) => {
    const cachedCount = toolCounts.get(s.id) ?? 0;
    const status = s.enabled ? "●" : "○";
    const toolInfo = cachedCount > 0 ? ` (${cachedCount} tools)` : "";

    return {
      label: `${status} ${s.name} [${s.id}]${toolInfo}`,
      value: s.id,
      server: s,
    };
  });

  const handleSelect = (item: { value: string; server: McpServerEntry }) => {
    onSelect(item.server);
  };

  return (
    <Box flexDirection="column">
      <Text bold>Registered Servers:</Text>
      <SelectInput items={items} onSelect={handleSelect as any} />
    </Box>
  );
}
