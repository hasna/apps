import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Domain } from "../../db/domains.js";
import { DomainTable } from "./DomainTable.js";

interface SearchViewProps {
  results: Domain[];
  selectedIndex: number;
  onSearch: (query: string) => void;
  onSelect: (domain: Domain) => void;
  onBack: () => void;
}

export function SearchView({
  results,
  selectedIndex,
  onSearch,
  onSelect,
  onBack,
}: SearchViewProps) {
  const [query, setQuery] = useState("");

  useInput((input, key) => {
    if (key.escape) onBack();
    if (key.return && results[selectedIndex]) {
      onSelect(results[selectedIndex]!);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Search domains</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Query: </Text>
        <TextInput
          value={query}
          onChange={(value) => {
            setQuery(value);
            onSearch(value);
          }}
          placeholder="name, registrar, notes…"
        />
      </Box>
      <Text dimColor>[enter] open · [esc] back</Text>
      <Box marginTop={1}>
        <DomainTable domains={results} selectedIndex={selectedIndex} />
      </Box>
    </Box>
  );
}
