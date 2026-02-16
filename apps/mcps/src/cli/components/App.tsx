import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ServerList } from "./ServerList.js";
import { ServerDetail } from "./ServerDetail.js";
import { SearchView } from "./SearchView.js";
import { ToolCall } from "./ToolCall.js";
import type { TuiView, McpServerEntry, McpTool } from "../../types.js";
import { disconnectAll } from "../../lib/proxy.js";
import { closeDb } from "../../lib/db.js";

export function App() {
  const { exit } = useApp();
  const [view, setView] = useState<TuiView>("servers");
  const [selectedServer, setSelectedServer] = useState<McpServerEntry | null>(null);
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);

  useInput((input, key) => {
    if (input === "q" && view !== "search" && view !== "call") {
      exit();
    }
    if (key.escape) {
      if (view === "call") {
        setView("detail");
        setSelectedTool(null);
      } else if (view === "detail") {
        setView("servers");
        setSelectedServer(null);
      } else if (view === "search") {
        setView("servers");
      } else {
        exit();
      }
    }
  });

  useEffect(() => {
    return () => {
      void disconnectAll().catch(() => undefined).finally(() => closeDb());
    };
  }, []);

  const handleSelectServer = (server: McpServerEntry) => {
    setSelectedServer(server);
    setView("detail");
  };

  const handleSearch = () => {
    setView("search");
  };

  const handleSelectTool = (tool: McpTool) => {
    setSelectedTool(tool);
    setView("call");
  };

  const handleBack = () => {
    if (view === "call") {
      setView("detail");
      setSelectedTool(null);
    } else if (view === "detail") {
      setView("servers");
      setSelectedServer(null);
    } else if (view === "search") {
      setView("servers");
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          mcps
        </Text>
        <Text dimColor> — MCP Server Registry</Text>
      </Box>

      {view === "servers" && (
        <ServerList
          onSelect={handleSelectServer}
          onSearch={handleSearch}
        />
      )}

      {view === "detail" && selectedServer && (
        <ServerDetail
          server={selectedServer}
          onSelectTool={handleSelectTool}
          onBack={handleBack}
        />
      )}

      {view === "search" && <SearchView onBack={handleBack} />}

      {view === "call" && selectedTool && selectedServer && (
        <ToolCall
          server={selectedServer}
          tool={selectedTool}
          onBack={handleBack}
        />
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {view === "servers"
            ? "↑↓ navigate · enter select · s search · q quit"
            : view === "detail"
              ? "esc back · q quit"
              : "esc back"}
        </Text>
      </Box>
    </Box>
  );
}
