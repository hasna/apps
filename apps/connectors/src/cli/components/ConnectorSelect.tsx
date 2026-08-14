import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { ConnectorMeta } from "../../lib/registry.js";

interface ConnectorSelectProps {
  connectors: ConnectorMeta[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

const COL_CHECK = 5;
const COL_NAME = 20;
const COL_VERSION = 10;

export function ConnectorSelect({
  connectors,
  selected,
  onToggle,
  onConfirm,
  onBack,
}: ConnectorSelectProps) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");

  // Filter connectors by the current search text
  const filteredConnectors = useMemo(() => {
    if (!filter) return connectors;
    const lower = filter.toLowerCase();
    return connectors.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        (c.description && c.description.toLowerCase().includes(lower))
    );
  }, [connectors, filter]);

  // Items: back + filtered connectors + confirm
  const totalItems = filteredConnectors.length + 2;

  // Clamp cursor when filter changes reduce the list
  const clampedCursor = useMemo(() => {
    if (cursor >= totalItems) return totalItems - 1;
    return cursor;
  }, [cursor, totalItems]);

  // Visible window for scrolling
  const maxVisible = 16;
  const scrollOffset = useMemo(() => {
    if (totalItems <= maxVisible) return 0;
    const half = Math.floor(maxVisible / 2);
    if (clampedCursor < half) return 0;
    if (clampedCursor > totalItems - maxVisible + half) return totalItems - maxVisible;
    return clampedCursor - half;
  }, [clampedCursor, totalItems]);

  useInput((input, key) => {
    if (key.escape) {
      if (filter) {
        // Clear filter first; only go back if filter is already empty
        setFilter("");
        setCursor(0);
      } else {
        onBack();
      }
    } else if (key.upArrow) {
      setCursor((c) => {
        const total = filteredConnectors.length + 2;
        return c > 0 ? c - 1 : total - 1;
      });
    } else if (key.downArrow) {
      setCursor((c) => {
        const total = filteredConnectors.length + 2;
        return c < total - 1 ? c + 1 : 0;
      });
    } else if (key.return) {
      const cur = clampedCursor;
      const total = filteredConnectors.length + 2;
      if (cur === 0) {
        onBack();
      } else if (cur === total - 1) {
        if (selected.size > 0) onConfirm();
      } else {
        onToggle(filteredConnectors[cur - 1].name);
      }
    } else if (input === " " && clampedCursor > 0 && clampedCursor < filteredConnectors.length + 1) {
      onToggle(filteredConnectors[clampedCursor - 1].name);
    } else if (input === "i" && selected.size > 0) {
      onConfirm();
    } else if (input === "a") {
      // Toggle all visible (filtered) connectors
      const allSelected = filteredConnectors.every((c) => selected.has(c.name));
      for (const c of filteredConnectors) {
        if (allSelected) {
          if (selected.has(c.name)) onToggle(c.name);
        } else {
          if (!selected.has(c.name)) onToggle(c.name);
        }
      }
    } else if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setCursor(0);
    } else if (input && /^[a-zA-Z0-9\-_.]$/.test(input) && input !== "a" && input !== "i") {
      // Alphanumeric typing appends to filter (excluding reserved keys)
      setFilter((f) => f + input);
      setCursor(0);
    }
  });

  const visibleStart = scrollOffset;
  const visibleEnd = Math.min(scrollOffset + maxVisible, totalItems);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select connectors to install:</Text>
        {filter ? (
          <Text color="yellow"> Filter: {filter}</Text>
        ) : null}
        {filter && filteredConnectors.length === 0 ? (
          <Text dimColor> (no matches)</Text>
        ) : filter ? (
          <Text dimColor> ({filteredConnectors.length} match{filteredConnectors.length !== 1 ? "es" : ""})</Text>
        ) : null}
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
          const isActive = clampedCursor === 0;
          return (
            <Box key="__back__">
              <Text
                color={isActive ? "cyan" : undefined}
                bold={isActive}
              >
                {isActive ? "❯ " : "  "}← Back to categories
              </Text>
            </Box>
          );
        }

        // Confirm row
        if (idx === totalItems - 1) {
          const isActive = clampedCursor === totalItems - 1;
          const hasSelection = selected.size > 0;
          return (
            <Box key="__confirm__">
              <Text
                color={isActive ? (hasSelection ? "green" : "gray") : hasSelection ? "green" : "gray"}
                bold={isActive}
                dimColor={!hasSelection}
              >
                {isActive ? "❯ " : "  "}✓ Install selected ({selected.size})
              </Text>
            </Box>
          );
        }

        // Connector row
        const c = filteredConnectors[idx - 1];
        const isActive = clampedCursor === idx;
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
          ↑↓ navigate  space/enter toggle  a select all  i install  type to filter  esc {filter ? "clear filter" : "back"}
        </Text>
      </Box>
    </Box>
  );
}
