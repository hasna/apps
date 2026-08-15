import React from "react";
import { Box, Text } from "ink";
import type { ProviderConfig } from "../../types/index.js";
import { isProviderConfigured } from "../../db/providers.js";

interface Props {
  providers: ProviderConfig[];
}

export function ProviderStatus({ providers }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>Search Providers</Text>
      <Text> </Text>
      {providers.map((p) => {
        const configured = isProviderConfigured(p);
        const statusColor = p.enabled
          ? configured
            ? "green"
            : "yellow"
          : "gray";
        const statusText = p.enabled
          ? configured
            ? "ready"
            : "no key"
          : "disabled";

        return (
          <Box key={p.name}>
            <Text>  </Text>
            <Text>{p.name.padEnd(14)}</Text>
            <Text color={statusColor}>{statusText.padEnd(12)}</Text>
            <Text dimColor>
              {p.apiKeyEnv ? `[${p.apiKeyEnv}]` : "[no key needed]"}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
