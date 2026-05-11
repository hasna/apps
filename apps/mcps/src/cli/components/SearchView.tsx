import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { searchRegistry, installFromRegistry } from "../../lib/remote.js";
import type { RegistryServer } from "../../types.js";

interface Props {
  onBack: () => void;
}

export function SearchView({ onBack }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistryServer[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSubmit = async (value: string) => {
    if (!value.trim()) return;
    setSearching(true);
    setMessage(null);
    setSearched(true);
    try {
      const res = await searchRegistry(value.trim());
      setResults(res);
      if (res.length === 0) {
        setMessage("No servers found.");
      }
    } catch (err) {
      setMessage(`Search failed: ${(err as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (item: { value: string }) => {
    if (item.value === "__back") {
      onBack();
      return;
    }

    setInstalling(item.value);
    setMessage(null);
    try {
      const server = await installFromRegistry(item.value, {
        localCommandConsent: { approved: true, source: "tui" },
      });
      setMessage(`Installed: ${server.name} [${server.id}]`);
    } catch (err) {
      setMessage(`Install failed: ${(err as Error).message}`);
    } finally {
      setInstalling(null);
    }
  };

  const items = [
    ...results.map((s) => ({
      label: `${s.name} — ${s.description || "No description"}`,
      value: s.id,
    })),
    { label: "← Back", value: "__back" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Search MCP Registry</Text>

      <Box marginTop={1}>
        <Text>Search: </Text>
        <TextInput
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          placeholder="Type a query and press Enter..."
        />
      </Box>

      {searching && (
        <Box marginTop={1}>
          <Text>
            <Spinner type="dots" /> Searching...
          </Text>
        </Box>
      )}

      {installing && (
        <Box marginTop={1}>
          <Text>
            <Spinner type="dots" /> Installing {installing}...
          </Text>
        </Box>
      )}

      {message && (
        <Box marginTop={1}>
          <Text color={message.includes("failed") ? "red" : "green"}>{message}</Text>
        </Box>
      )}

      {!searching && searched && results.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Results ({results.length}):</Text>
          <SelectInput items={items} onSelect={handleSelect as any} />
        </Box>
      )}
    </Box>
  );
}
