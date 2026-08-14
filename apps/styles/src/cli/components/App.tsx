import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { StyleMeta } from "../../lib/registry.js";

interface AppProps {
  styles: StyleMeta[];
}

export function App({ styles }: AppProps) {
  const { exit } = useApp();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }

    if (showDetail) {
      if (key.escape || input === "b") {
        setShowDetail(false);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(styles.length - 1, i + 1));
    } else if (key.return || input === " ") {
      setShowDetail(true);
    }
  });

  const selected = styles[selectedIndex];

  if (showDetail && selected) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          {selected.displayName}
        </Text>
        <Text dimColor>{selected.category}</Text>
        <Box marginTop={1}>
          <Text>{selected.description}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Principles:</Text>
          {selected.principles.map((p, i) => (
            <Text key={i}>  • {p}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Tags: {selected.tags.join(", ")}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press ESC or "b" to go back, "q" to quit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Open Styles — Browse Styles
      </Text>
      <Text dimColor>↑↓ navigate  ENTER view details  q quit</Text>
      <Box marginTop={1} flexDirection="column">
        {styles.map((style, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={style.name}>
              <Text
                bold={isSelected}
                color={isSelected ? "cyan" : undefined}
                backgroundColor={isSelected ? "blue" : undefined}
              >
                {isSelected ? "▶ " : "  "}
                {style.displayName.padEnd(20)}
                <Text dimColor={!isSelected}> {style.category.padEnd(16)}</Text>
                <Text dimColor> {style.tags.slice(0, 3).join(", ")}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
