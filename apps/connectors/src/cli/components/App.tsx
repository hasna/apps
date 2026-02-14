import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import { Header } from "./Header.js";
import { CategorySelect } from "./CategorySelect.js";
import { ConnectorSelect } from "./ConnectorSelect.js";
import { SearchView } from "./SearchView.js";
import { InstallProgress } from "./InstallProgress.js";
import {
  getConnectorsByCategory,
  ConnectorMeta,
  Category,
} from "../../lib/registry.js";
import { InstallResult } from "../../lib/installer.js";

type View = "main" | "browse" | "search" | "connectors" | "installing" | "done";

interface AppProps {
  initialConnectors?: string[];
  overwrite?: boolean;
}

export function App({ initialConnectors, overwrite = false }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(
    initialConnectors?.length ? "installing" : "main"
  );
  const [category, setCategory] = useState<Category | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialConnectors || [])
  );
  const [results, setResults] = useState<InstallResult[]>([]);

  useInput((input, key) => {
    if (key.escape) {
      if (view === "main") {
        exit();
      } else if (view === "browse" || view === "search") {
        setView("main");
      } else if (view === "connectors") {
        setCategory(null);
        setView("browse");
      }
    }
    if (input === "q" && view !== "search") {
      exit();
    }
  });

  const handleToggle = (name: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelected(newSelected);
  };

  const handleConfirm = () => {
    if (selected.size > 0) {
      setView("installing");
    }
  };

  const handleComplete = (installResults: InstallResult[]) => {
    setResults(installResults);
    setView("done");
  };

  const mainMenuItems = [
    { label: "Browse by category", value: "browse" },
    { label: "Search connectors", value: "search" },
    { label: "Exit", value: "exit" },
  ];

  const handleMainSelect = (item: { value: string }) => {
    if (item.value === "exit") {
      exit();
    } else {
      setView(item.value as View);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        title="Connectors"
        subtitle="Install API connectors for your project"
      />

      {view === "main" && (
        <Box flexDirection="column">
          <Box marginBottom={1}><Text>What would you like to do?</Text></Box>
          <SelectInput items={mainMenuItems} onSelect={handleMainSelect} />
          <Box marginTop={1}>
            <Text dimColor>Press q to quit</Text>
          </Box>
        </Box>
      )}

      {view === "browse" && !category && (
        <CategorySelect
          onSelect={(cat) => {
            setCategory(cat as Category);
            setView("connectors");
          }}
          onBack={() => setView("main")}
        />
      )}

      {view === "connectors" && category && (
        <ConnectorSelect
          connectors={getConnectorsByCategory(category)}
          selected={selected}
          onToggle={handleToggle}
          onConfirm={handleConfirm}
          onBack={() => {
            setCategory(null);
            setView("browse");
          }}
        />
      )}

      {view === "search" && (
        <SearchView
          selected={selected}
          onToggle={handleToggle}
          onConfirm={handleConfirm}
          onBack={() => setView("main")}
        />
      )}

      {view === "installing" && (
        <InstallProgress
          connectors={Array.from(selected)}
          overwrite={overwrite}
          onComplete={handleComplete}
        />
      )}

      {view === "done" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="green">
              Installation complete!
            </Text>
          </Box>

          {results.filter((r) => r.success).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>Installed:</Text>
              {results
                .filter((r) => r.success)
                .map((r) => (
                  <Text key={r.connector} color="green">
                    ✓ {r.connector}
                  </Text>
                ))}
            </Box>
          )}

          {results.filter((r) => !r.success).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="red">
                Failed:
              </Text>
              {results
                .filter((r) => !r.success)
                .map((r) => (
                  <Text key={r.connector} color="red">
                    ✗ {r.connector}: {r.error}
                  </Text>
                ))}
            </Box>
          )}

          <Box marginTop={1} flexDirection="column">
            <Text bold>Next steps:</Text>
            <Text>1. Import from .connectors/</Text>
            <Text dimColor>   import {"{"} figma {"}"} from './.connectors'</Text>
            <Text>2. Configure your API keys</Text>
            <Text>3. Start building!</Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>Press q to exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
