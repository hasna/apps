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
  // Items: back + connectors + confirm
  const totalItems = connectors.length + 2;
  const [cursor, setCursor] = useState(0);

  // Visible window for scrolling
  const maxVisible = 16;
  const scrollOffset = useMemo(() => {
    if (totalItems <= maxVisible) return 0;
    const half = Math.floor(maxVisible / 2);
    if (cursor < half) return 0;
    if (cursor > totalItems - maxVisible + half) return totalItems - maxVisible;
    return cursor - half;
  }, [cursor, totalItems]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : totalItems - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < totalItems - 1 ? c + 1 : 0));
    } else if (key.return) {
      if (cursor === 0) {
        onBack();
      } else if (cursor === totalItems - 1) {
        if (selected.size > 0) onConfirm();
      } else {
        // Enter on a connector toggles it; if there's a selection, also confirm
        onToggle(connectors[cursor - 1].name);
      }
    } else if (input === " " && cursor > 0 && cursor < totalItems - 1) {
      onToggle(connectors[cursor - 1].name);
    } else if (input === "i" && selected.size > 0) {
      onConfirm();
    } else if (input === "a") {
      // Toggle all: if all are selected, deselect all; otherwise select all
      const allSelected = connectors.every((c) => selected.has(c.name));
      for (const c of connectors) {
        if (allSelected) {
          if (selected.has(c.name)) onToggle(c.name);
        } else {
          if (!selected.has(c.name)) onToggle(c.name);
        }
      }
    }
  });

  const visibleStart = scrollOffset;
  const visibleEnd = Math.min(scrollOffset + maxVisible, totalItems);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select connectors to install:</Text>
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
          const isActive = cursor === 0;
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
          const isActive = cursor === totalItems - 1;
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
        const c = connectors[idx - 1];
        const isActive = cursor === idx;
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
          ↑↓ navigate  space/enter toggle  a select all  i install  esc back
        </Text>
      </Box>
    </Box>
  );
}
