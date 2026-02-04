import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { ConnectorMeta } from "../../lib/registry.js";

interface ConnectorSelectProps {
  connectors: ConnectorMeta[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function ConnectorSelect({
  connectors,
  selected,
  onToggle,
  onConfirm,
  onBack,
}: ConnectorSelectProps) {
  const items = [
    { label: "← Back to categories", value: "__back__" },
    ...connectors.map((c) => ({
      label: `${selected.has(c.name) ? "[x]" : "[ ]"} ${c.displayName}`,
      value: c.name,
    })),
    { label: "", value: "__sep__" },
    {
      label: `✓ Install selected (${selected.size})`,
      value: "__confirm__",
    },
  ];

  const handleSelect = (item: { value: string }) => {
    if (item.value === "__back__") {
      onBack();
    } else if (item.value === "__confirm__") {
      if (selected.size > 0) {
        onConfirm();
      }
    } else if (item.value !== "__sep__") {
      onToggle(item.value);
    }
  };

  // Find the current connector for description
  const [highlightedIndex, setHighlightedIndex] = useState(1);
  const currentConnector = connectors[highlightedIndex - 1];

  return (
    <Box flexDirection="column">
      <Text bold marginBottom={1}>
        Select connectors (space to toggle, enter to confirm):
      </Text>

      <Box flexDirection="row">
        <Box flexDirection="column" width="50%">
          <SelectInput
            items={items}
            onSelect={handleSelect}
            onHighlight={(item) => {
              const idx = connectors.findIndex((c) => c.name === item.value);
              if (idx >= 0) setHighlightedIndex(idx + 1);
            }}
          />
        </Box>

        <Box flexDirection="column" marginLeft={2} width="50%">
          {currentConnector && (
            <>
              <Text bold color="cyan">
                {currentConnector.displayName}
              </Text>
              <Text>{currentConnector.description}</Text>
              <Text dimColor>
                Tags: {currentConnector.tags.join(", ")}
              </Text>
            </>
          )}
        </Box>
      </Box>

      {selected.size > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Selected: {Array.from(selected).join(", ")}
          </Text>
        </Box>
      )}
    </Box>
  );
}
