#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOpenLoopsMcpServer } from "./server.js";

const server = createOpenLoopsMcpServer();
await server.connect(new StdioServerTransport());
