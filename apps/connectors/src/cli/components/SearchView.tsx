import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { searchConnectors, ConnectorMeta } from "../../lib/registry.js";

interface SearchViewProps {
  selected: Set<string>;
  onToggle: (name: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

const COL_CHECK = 5;
const COL_NAME = 20;
const COL_VERSION = 10;

export function SearchView({
  selected,
  onToggle,
  onConfirm,
  onBack,
}: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConnectorMeta[]>([]);
  const [mode, setMode] = useState<"search" | "select">("search");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (query.length >= 2) {
      setResults(searchConnectors(query));
      setCursor(0);
    } else {
      setResults([]);
    }
  }, [query]);

  // Items: back + results + (confirm if selection exists)
  const hasConfirm = selected.size > 0;
  const totalItems = results.length + 1 + (hasConfirm ? 1 : 0);

  const maxVisible = 14;
  const scrollOffset = useMemo(() => {
    if (totalItems <= maxVisible) return 0;
    const half = Math.floor(maxVisible / 2);
    if (cursor < half) return 0;
    if (cursor > totalItems - maxVisible + half) return totalItems - maxVisible;
    return cursor - half;
  }, [cursor, totalItems]);

  useInput((input, key) => {
    if (key.escape) {
      if (mode === "select") {
        setMode("search");
      } else {
        onBack();
      }
      return;
    }

    if (mode === "search") {
      if (key.downArrow && results.length > 0) {
        setMode("select");
        setCursor(0);
      }
      return;
    }

    // select mode
    if (key.upArrow) {
      if (cursor === 0) {
        setMode("search");
      } else {
        setCursor((c) => c - 1);
      }
    } else if (key.downArrow) {
      setCursor((c) => (c < totalItems - 1 ? c + 1 : c));
    } else if (key.return) {
      if (cursor === 0) {
        onBack();
      } else if (hasConfirm && cursor === totalItems - 1) {
        onConfirm();
      } else {
        const connectorIdx = cursor - 1;
        if (connectorIdx < results.length) {
          onToggle(results[connectorIdx].name);
        }
      }
    } else if (input === " " && cursor > 0) {
      const connectorIdx = cursor - 1;
      if (connectorIdx < results.length) {
        onToggle(results[connectorIdx].name);
      }
    }
  });

  const visibleStart = scrollOffset;
  const visibleEnd = Math.min(scrollOffset + maxVisible, totalItems);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Search: </Text>
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Type to search connectors..."
          focus={mode === "search"}
        />
      </Box>

      {query.length < 2 && (
        <Text dimColor>Type at least 2 characters to search</Text>
      )}

      {query.length >= 2 && results.length === 0 && (
        <Text dimColor>No connectors found for "{query}"</Text>
      )}

      {results.length > 0 && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              Found {results.length} connector(s)
              {mode === "search" ? " — press ↓ to select" : ""}:
            </Text>
          </Box>

          {/* Table header */}
          <Box>
            <Box width={COL_CHECK}>
              <Text dimColor> </Text>
            </Box>
            <Box width={COL_NAME}>
              <Text bold dimColor>Connector</Text>
            </Box>
            <Box width={COL_VERSION}>
              <Text bold dimColor>Version</Text>
            </Box>
            <Text bold dimColor>Description</Text>
          </Box>

          {/* Separator */}
          <Box marginBottom={0}>
            <Text dimColor>{"─".repeat(70)}</Text>
          </Box>

          {/* Scroll indicator top */}
          {visibleStart > 0 && (
            <Text dimColor>  ↑ {visibleStart} more</Text>
          )}

          {/* Rows */}
          {Array.from({ length: visibleEnd - visibleStart }, (_, i) => {
            const idx = visibleStart + i;

            // Back row
            if (idx === 0) {
              const isActive = mode === "select" && cursor === 0;
              return (
                <Box key="__back__">
                  <Text
                    color={isActive ? "cyan" : undefined}
                    bold={isActive}
                  >
                    {isActive ? "❯ " : "  "}← Back
                  </Text>
                </Box>
              );
            }

            // Confirm row
            if (hasConfirm && idx === totalItems - 1) {
              const isActive = mode === "select" && cursor === totalItems - 1;
              return (
                <Box key="__confirm__">
                  <Text
                    color={isActive ? "green" : "green"}
                    bold={isActive}
                    dimColor={!isActive}
                  >
                    {isActive ? "❯ " : "  "}✓ Install selected ({selected.size})
                  </Text>
                </Box>
              );
            }

            // Connector row
            const c = results[idx - 1];
            if (!c) return null;
            const isActive = mode === "select" && cursor === idx;
            const isChecked = selected.has(c.name);

            return (
              <Box key={c.name}>
                <Box width={2}>
                  <Text color={isActive ? "cyan" : undefined}>
                    {isActive ? "❯" : " "}
                  </Text>
                </Box>
                <Box width={COL_CHECK - 2}>
                  <Text color={isChecked ? "green" : "gray"}>
                    {isChecked ? "[✓]" : "[ ]"}
                  </Text>
                </Box>
                <Box width={COL_NAME}>
                  <Text bold={isActive} color={isActive ? "cyan" : undefined}>
                    {c.name}
                  </Text>
                </Box>
                <Box width={COL_VERSION}>
                  <Text dimColor>{c.version || "-"}</Text>
                </Box>
                <Text wrap="truncate">
                  {c.description}
                </Text>
              </Box>
            );
          })}

          {/* Scroll indicator bottom */}
          {visibleEnd < totalItems && (
            <Text dimColor>  ↓ {totalItems - visibleEnd} more</Text>
          )}
        </Box>
      )}

      {/* Selected summary */}
      {selected.size > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Selected: {Array.from(selected).join(", ")}
          </Text>
        </Box>
      )}

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          {mode === "search"
            ? "type to search  ↓ select results  esc back"
            : "↑↓ navigate  space toggle  enter confirm  esc search"}
        </Text>
      </Box>
    </Box>
  );
}
